"""Hardware-free named walk persistence, mapping, pacing and hold tests."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"firmware"/"pico"))
import named_gait
import servo_channels
from dog_engine import DogEngine
from gimbal_engine import GimbalEngine
from test_servo_channels import Board


class NamedWalkTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.previous=os.getcwd();os.chdir(self.tmp.name)
        self.now=0
        servo_channels.time.ticks_ms=lambda:self.now
        servo_channels.time.ticks_diff=lambda a,b:a-b
        self.board=Board()
        self.channels=servo_channels.ServoChannels(self.board,DogEngine(self.board),GimbalEngine(self.board))
        for ch in (1,2,3,5,6):
            c=self.channels.channels[ch].copy();c["locked"]=False;self.channels.configure(c)
            c.update(name="Joint %d"%ch,enabled=True,calibrated=True,a_name="Up" if ch!=6 else "Back",
                     b_name="Down" if ch!=6 else "Forward",a_us=1450,b_us=1550,center_us=1500)
            self.channels.configure(c)
        self.gait=named_gait.NamedGait(self.channels)
        self.order=[(1,"Up"),(3,"Up"),(6,"Back"),(1,"Down"),(3,"Down"),(5,"Up"),(2,"Up"),(6,"Forward"),(5,"Down"),(2,"Down")]
        self.plan={"version":1,"speed_us_s":150,"lift_percent":100,"paired_feet":False,"steps":[self.bound(ch,p) for ch,p in self.order]}
    def tearDown(self):
        os.chdir(self.previous);self.tmp.cleanup()
    def bound(self,ch,p):
        c=self.channels.channels[ch]
        return dict(channel=ch,position=p,binding={k:c[k] for k in ("name","a_name","b_name","a_us","b_us","center_us")})
    def tick(self,n=1):
        for _ in range(n):
            self.now+=20;self.channels.step();self.gait.step()
    def test_save_and_boot_do_not_move_and_persist(self):
        self.gait.save(self.plan);restored=named_gait.NamedGait(self.channels)
        self.assertEqual(restored.plan["steps"],self.plan["steps"]);self.assertFalse(restored.running)
        self.assertEqual(self.board.writes,[])
    def test_full_cycle_one_servo_at_a_time_and_all_keep_holding(self):
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        release_count=len(self.board.releases)
        self.tick(1300)
        self.assertFalse(self.gait.running);self.assertIsNone(self.gait.error)
        self.assertEqual(len(self.board.releases),release_count,"no releases between steps or at completion")
        runs=[]
        for port,pulse in self.board.writes:
            if not runs or runs[-1][0]!=port:runs.append([port,pulse])
            else:runs[-1][1]=pulse
        # Establish four feet Down; the first slide command follows foot lift.
        self.assertEqual([(p-1,v) for p,v in runs[:4]],[(1,1550),(3,1550),(5,1550),(2,1550)])
        self.assertEqual([(p-1,v) for p,v in runs[4:]],[(ch,1450 if pos in ("Up","Back") else 1550) for ch,pos in self.order])
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))
        self.assertFalse(self.gait.status()["physical_feedback"])
    def test_repeated_forward_does_not_restart_cycle(self):
        self.gait.save(self.plan);self.gait.start(path_clear=True);self.tick(100)
        index=self.gait.index;run=self.gait.run_id
        self.gait.start(path_clear=True);self.assertEqual(self.gait.index,index);self.assertEqual(self.gait.run_id,run)
    def test_stale_calibration_or_label_refuses_before_moving(self):
        self.gait.save(self.plan);self.channels.channels[5]["name"]="Changed"
        with self.assertRaises(ValueError):self.gait.start(path_clear=True)
        self.assertEqual(self.board.writes,[])
    def test_invalid_save_preserves_previous(self):
        self.gait.save(self.plan);old=Path("named_walk.json").read_bytes()
        invalid=json.loads(json.dumps(self.plan));invalid["steps"][0]["position"]="Wrong"
        with self.assertRaises(ValueError):self.gait.save(invalid)
        self.assertEqual(Path("named_walk.json").read_bytes(),old)
    def test_stop_releases_and_no_further_steps(self):
        self.gait.save(self.plan);self.gait.start(path_clear=True);self.tick(10);self.gait.cancel()
        count=len(self.board.writes);self.tick(1000)
        self.assertEqual(len(self.board.writes),count);self.assertFalse(self.gait.running)

    def test_three_cycles_prepare_once_and_finish_feet_down(self):
        self.plan.update(cycles=3,speed_us_s=400)
        before=json.dumps(self.channels.channels)
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        self.assertEqual(self.channels.speed,400)
        self.assertEqual([(s['channel'],s['position']) for s in self.gait.pending[4:]],self.order*3)
        for _ in range(2000):
            self.tick()
            if self.gait.waiting_for_vision:
                state=self.gait.status()
                self.gait.continue_after_vision(state['run_id'],state['completed_cycles'],True)
        self.assertFalse(self.gait.running);self.assertIsNone(self.gait.error)
        self.assertEqual(self.gait.status()['completed_cycles'],3)
        self.assertEqual(self.gait.status()['completed_steps'],34)
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))
        self.assertEqual(json.dumps(self.channels.channels),before)
        restored=named_gait.NamedGait(self.channels)
        self.assertEqual(restored.plan['cycles'],3);self.assertEqual(restored.plan['speed_us_s'],400)

    def test_bad_cycle_or_speed_preserves_saved_plan(self):
        self.gait.save(self.plan);before=Path('named_walk.json').read_bytes()
        for field,values in [('cycles',[0,11,True,1.5,'3']),('speed_us_s',[0,1601,True,150.5,'400']),('settle_ms',[-1,501,True]),('paired_feet',[1,'yes'])]:
            for value in values:
                with self.assertRaises(ValueError):self.gait.save(dict(self.plan,**{field:value}))
                self.assertEqual(Path('named_walk.json').read_bytes(),before)

    def test_stop_during_later_cycle_does_not_resume(self):
        self.plan.update(cycles=3,speed_us_s=400)
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        for _ in range(2000):
            self.tick()
            if self.gait.waiting_for_vision:
                self.gait.continue_after_vision(self.gait.run_id,self.gait.status()['completed_cycles'],True)
            if self.gait.index>=17:break
        self.assertGreaterEqual(self.gait.index,17)
        self.gait.cancel();count=len(self.board.writes);self.tick(3000)
        self.assertFalse(self.gait.running);self.assertEqual(len(self.board.writes),count)

    def test_walk_pace_does_not_increase_calibration_speed(self):
        self.channels.move([dict(channel=1,position='Up')],calibration=True,speed=800)
        self.assertEqual(self.channels.speed,150)

    def test_fast_walk_persists_and_reaches_same_endpoints(self):
        self.plan.update(speed_us_s=800)
        before=json.dumps(self.channels.channels)
        self.gait.save(self.plan);self.gait.start(bench=True)
        self.assertEqual(self.channels.speed,800)
        self.assertEqual(self.gait.status()['settle_ms'],20)
        self.assertEqual(named_gait.NamedGait(self.channels).plan['speed_us_s'],800)
        self.tick(1300)
        self.assertFalse(self.gait.running);self.assertIsNone(self.gait.error)
        self.assertEqual(self.gait.status()['completed_steps'],14)
        self.assertEqual(json.dumps(self.channels.channels),before)
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))

    def test_old_plan_is_one_cycle_at_original_speed(self):
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        self.assertEqual(len(self.gait.pending),14);self.assertEqual(self.channels.speed,150)

    def test_paired_diagonal_feet_start_on_same_tick_slide_waits(self):
        self.plan.update(paired_feet=True,speed_us_s=1000,lift_percent=50)
        self.gait.save(self.plan);self.gait.start(bench=True)
        observed=[]
        while self.gait.running:
            start=len(self.board.writes);self.tick()
            writes=self.board.writes[start:]
            if self.gait.index>=4 and writes:observed.append((self.gait.index,writes))
            self.assertLess(self.now,15000)
        pair_ticks=[w for i,w in observed if {p for p,v in w}=={2,4}]
        self.assertTrue(pair_ticks,'LF and RR must receive PWM on the same scheduler tick')
        for i,writes in observed:
            if i in (6,11):
                self.assertTrue(all(p==7 for p,v in writes),'slide phase must not overlap foot ramps')
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))
        self.assertIsNone(self.gait.error)

    def test_continuous_cycles_have_no_repreparation_or_phone_boundary_wait(self):
        self.plan.update(paired_feet=True,speed_us_s=1000)
        self.gait.save(self.plan);before=json.dumps(self.channels.channels)
        self.gait.start(bench=True,continuous=True)
        run=self.gait.run_id
        for i in range(1000):
            self.tick()
            if i%25==0:self.gait.keepalive(run)
            self.assertLessEqual(len(self.gait.pending),15,'continuous memory must stay bounded')
            if self.gait.status()['completed_cycles']>=5:break
        self.assertGreaterEqual(self.gait.status()['completed_cycles'],5)
        self.assertTrue(self.gait.running);self.assertEqual(self.gait.run_id,run)
        self.assertEqual(self.gait.preparation_steps,0)
        self.assertEqual(self.gait.pending,self.gait.sequence)
        self.assertFalse(self.gait.waiting_for_vision)
        self.assertEqual(json.dumps(self.channels.channels),before)
        self.gait.cancel();count=len(self.board.writes);self.tick(500)
        self.assertEqual(len(self.board.writes),count)
        with self.assertRaises(ValueError):self.gait.keepalive(run)

    def test_continuous_lease_expires_and_stale_reply_cannot_restart(self):
        self.gait.save(self.plan)
        with self.assertRaises(ValueError):self.gait.start(path_clear=False,continuous=True)
        self.gait.start(bench=True,continuous=True);run=self.gait.run_id
        with self.assertRaises(ValueError):self.gait.keepalive(run+1)
        self.tick(151)
        self.assertFalse(self.gait.running);self.assertEqual(self.gait.error,'manual_control_timed_out')
        count=len(self.board.writes);self.tick(100)
        with self.assertRaises(ValueError):self.gait.keepalive(run)
        self.assertEqual(len(self.board.writes),count)

    def test_paired_reverse_finishes_both_feet_before_slide(self):
        self.plan.update(paired_feet=True,speed_us_s=1000)
        self.gait.save(self.plan);self.gait.start(direction='backward',bench=True)
        paired=[]
        for _ in range(1000):
            start=len(self.board.writes);self.tick()
            writes=self.board.writes[start:]
            if len(writes)==2:paired.append({p for p,v in writes})
        self.assertIn({3,6},paired);self.assertIn({2,4},paired)
        self.assertFalse(self.gait.running);self.assertIsNone(self.gait.error)

    def test_paired_calibration_is_rejected_without_pwm(self):
        with self.assertRaises(ValueError):
            self.channels.move([dict(channel=1,position='Up'),dict(channel=3,position='Up')],calibration=True,parallel=True)
        self.assertEqual(self.board.writes,[])

    def test_no_clearance_no_movement(self):
        self.gait.save(self.plan)
        with self.assertRaises(ValueError):self.gait.start()
        self.assertEqual(self.board.writes,[])

    def test_half_lift_and_reverse_transitions(self):
        self.plan.update(lift_percent=50,cycles=3,speed_us_s=400)
        self.gait.save(self.plan);self.gait.start(direction='backward',bench=True)
        expected=[(2,'Up'),(5,'Up'),(6,'Back'),(2,'Down'),(5,'Down'),(3,'Up'),(1,'Up'),(6,'Forward'),(3,'Down'),(1,'Down')]
        self.assertEqual([(s['channel'],s['position']) for s in self.gait.pending[4:]],expected)
        self.tick(2000)
        self.assertEqual(self.gait.status()['completed_cycles'],1,'bench ignores multi-cycle setting')
        for port,pulse in self.board.writes:
            if port-1!=6:self.assertGreaterEqual(pulse,1500,'half lift never goes to full Up (1450)')
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))

    def test_gate_waits_feet_down_rejects_replay_and_times_out_holding(self):
        self.plan.update(cycles=3,speed_us_s=400)
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        for _ in range(2000):
            self.tick()
            if self.gait.waiting_for_vision:break
        self.assertTrue(self.gait.waiting_for_vision)
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5,6)))
        count=len(self.board.writes);self.tick(100)
        self.assertEqual(len(self.board.writes),count)
        with self.assertRaises(ValueError):self.gait.continue_after_vision(self.gait.run_id,0,True)
        with self.assertRaises(ValueError):self.gait.continue_after_vision(self.gait.run_id,1,False)
        self.tick(2300)
        self.assertFalse(self.gait.running);self.assertEqual(self.gait.error,'vision_check_timed_out')
        self.assertTrue(self.channels.owning);self.assertEqual(len(self.board.writes),count)
        with self.assertRaises(ValueError):self.gait.continue_after_vision(self.gait.run_id,1,True)

if __name__=="__main__":unittest.main()
