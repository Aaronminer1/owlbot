"""Real dispatcher, synthetic stock pose streams, fake hardware only."""
import math
import unittest
import test_stock_fanout as base
from stock_body import StockBody


class StockBodyTests(unittest.TestCase):
    def setUp(self):
        self.fixture=base.StockTests();self.fixture.setUp()
        self.f=self.fixture.f;self.channels=self.f.channels;self.board=self.f.board
        self.channels.channels[6].update(name='Slide',a_name='Forward',b_name='Back',
            a_us=1003,b_us=1777,center_us=1390)
        self.channels.channels[7].update(name='Turn',enabled=True,calibrated=True,
            a_name='Closed',b_name='Open',a_us=1678,b_us=1019,center_us=1349)
        self.f.plan.update(lift_percent=50,speed_us_s=1600)
        self.f.plan['steps']=[self.f.bound(ch,pos) for ch,pos in self.f.order]
        self.f.gait.save(self.f.plan)
        self.stock=StockBody(self.channels,self.f.gait)
        self.channels.stop_stock=self.stock.stop
        self.f.env.update(stock_fanout=self.stock,apply_pose=self.stock.pose,
                          dog=self.channels.dog,gaze=self.channels.gaze)
    def tearDown(self):self.fixture.tearDown()
    def tick(self,left=None,right=None,n=1):
        for _ in range(n):
            self.f.now+=20
            if left is not None:self.stock.pose(left,right)
            self.channels.step();self.stock.step()
    def oscillate(self,n=1000):
        for i in range(n):
            a=30*math.sin(i*math.pi/18)
            self.tick(90+a,90+a)
    def test_static_slider_tuck_stand_and_jitter_do_not_start_steps(self):
        for l,r in ((90,90),(180,0),(0,180),(120,90),(90,120)):
            self.tick(l,r,100)
            self.assertFalse(self.stock.walking)
        for i in range(200):self.tick(90+(i%2)*2,90)
        self.assertFalse(self.stock.walking)
        self.assertFalse(any(port==7 for port,pulse in self.board.writes))
    def test_neutral_stream_commands_down_without_initial_midpoint_crouch(self):
        self.tick(90,90,65)
        self.assertFalse(self.stock.walking)
        for port,pulse in self.board.writes:
            c=self.channels.channels[port-1]
            self.assertEqual(pulse,c['b_us'])
    def test_stream_lift_is_down_based_but_gestures_keep_their_mapping(self):
        self.tick(135,45)
        for row in self.stock.mapping():
            self.assertEqual(self.stock.targets[row['channel']],round((row['down']+row['up_limit'])/2))
        self.stock.enqueue([dict(l=90,r=90,ms=200)])
        self.tick(n=15)
        self.assertEqual(self.stock.targets,self.stock.map_pose(90,90))
    def test_streamed_alternation_coordinates_four_legs_slide_and_closed_turn(self):
        self.oscillate()
        self.assertTrue(self.stock.walking);self.assertGreaterEqual(self.stock.completed_cycles,1)
        self.assertEqual({port-1 for port,pulse in self.board.writes},{1,2,3,5,6,7})
        slide={pulse for port,pulse in self.board.writes if port==7}
        self.assertIn(1003,slide);self.assertIn(1777,slide)
        self.assertEqual({pulse for port,pulse in self.board.writes if port==8},{1678})
        self.assertFalse(self.f.gait.running) # no fabricated path_clear/bench flag
    def test_support_diagonals_clear_before_slide_changes(self):
        self.oscillate(50)
        saw_back=False;saw_forward=False
        for i in range(900):
            before=len(self.board.writes)
            a=30*math.sin((i+50)*math.pi/18);self.tick(90+a,90+a)
            slide_writes=[u for p,u in self.board.writes[before:] if p==7]
            if not slide_writes:continue
            phase=self.stock.phases[self.stock.phase_index]
            if phase[0]['channel']!=6:continue
            pair=(1,3) if phase[0]['position']=='Back' else (5,2)
            for ch in pair:
                expected=self.f.gait._target(dict(channel=ch,position='Up'))['pulse_us']
                self.assertEqual(self.channels.current[ch],expected)
            if pair==(1,3):saw_back=True
            else:saw_forward=True
        self.assertTrue(saw_back and saw_forward)
    def test_silence_stops_and_no_replay(self):
        self.oscillate(100);self.assertTrue(self.stock.walking)
        self.tick(n=27);self.assertFalse(self.stock.walking)
        self.assertEqual(self.stock.last_stop_reason,'pose_stream_timeout')
        self.assertEqual(self.channels.current,{})
        self.tick(120,120,100);self.assertFalse(self.stock.walking)
    def test_repeated_frozen_pose_cannot_renew_gait(self):
        self.oscillate(100);self.tick(120,120,70)
        self.assertFalse(self.stock.walking)
        self.assertEqual(self.stock.last_stop_reason,'support_pattern_timeout')
    def test_neutral_hold_stops(self):
        self.oscillate(100);self.tick(90,90,15)
        self.assertFalse(self.stock.walking)
        self.assertEqual(self.stock.last_stop_reason,'neutral_pose_held')
    def test_gesture_oscillation_does_not_start_walk(self):
        self.f.send(t='act',steps=[dict(l=120,r=120,ms=200),dict(l=60,r=60,ms=200)]*10)
        self.tick(n=250);self.assertFalse(self.stock.walking)
        self.assertFalse(any(p==7 for p,u in self.board.writes))
    def test_stop_gesture_and_manual_commands_preempt_steps(self):
        self.oscillate(100);self.f.send(t='stop');self.assertFalse(self.stock.walking)
        self.oscillate(100);self.f.send(t='routine',name='wiggle');self.assertFalse(self.stock.walking)
        self.stock.stop();self.oscillate(100)
        self.channels.move([dict(channel=1,position='Down')]);self.assertFalse(self.stock.walking)
    def test_ambiguous_or_changed_binding_rejected_before_slide_output(self):
        self.channels.channels[6]['name']='Wrong device'
        with self.assertRaises(ValueError):self.oscillate(100)
        self.assertFalse(any(p==7 for p,u in self.board.writes))
    def test_tuck_ceiling_and_saved_calibration_preserved(self):
        before=[dict(c) for c in self.channels.channels];self.oscillate()
        rows={r['channel']:r for r in self.stock.mapping()}
        for port,pulse in self.board.writes:
            if port-1 in rows:self.assertEqual(pulse,self.stock.bound_pulse(rows[port-1],pulse))
        self.assertEqual(before,self.channels.channels)

    def test_sixty_percent_walk_lift_does_not_expand_fold_limits(self):
        before=[dict(c) for c in self.channels.channels]
        self.f.gait.plan['lift_percent']=60
        self.stock._make_phases()
        for index in (0,3):
            for target in self.stock.cycle[index]:
                c=self.channels.channels[target['channel']]
                ends={c['a_name'].lower():c['a_us'],c['b_name'].lower():c['b_us']}
                self.assertEqual(target['pulse_us'],round(ends['down']+(ends['up']-ends['down'])*.6))
        self.assertEqual(self.stock.status()['stock_walk']['lift_percent'],60)
        self.assertEqual(self.stock.MAX_LIFT_PERCENT,50)
        folded=self.stock.map_pose(180,0)
        for row in self.stock.mapping():
            self.assertEqual(folded[row['channel']],row['up_limit'])
        self.assertEqual(before,self.channels.channels)
    def test_status_is_truthful_and_does_not_drive_hardware(self):
        before=list(self.board.writes);s=self.stock.status()
        self.assertFalse(s['stock_walk']['steering_decoded']);self.assertFalse(s['locomotion_verified'])
        self.assertEqual(before,self.board.writes)
    def test_idle_and_repeated_stop_never_command_a_legacy_rest_pose(self):
        for _ in range(3):
            ack=self.f.send(t='stop')
            self.assertTrue(ack['ok']);self.assertFalse(ack['holding'])
        self.assertEqual(self.board.writes,[])
        self.oscillate(100)
        self.stock.stop('pose_stream_timeout')
        before=list(self.board.writes)
        self.f.send(t='stop');self.f.send(t='stop')
        self.assertEqual(before,self.board.writes)


if __name__=='__main__':unittest.main()
