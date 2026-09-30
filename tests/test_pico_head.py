import unittest
from test_named_gait import NamedWalkTests
from pico_head import PicoHead

class HeadTests(NamedWalkTests):
    def setUp(self):
        super().setUp()
        for ch in (8,9):
            self.channels.channels[ch].update(enabled=True,calibrated=True,a_us=1300,b_us=1700,center_us=1500)
        self.head=PicoHead(self.channels,lambda:{'gimbal_pan':8,'gimbal_tilt':9})
        self.channels.stop_head=self.head.stop

    def test_head_does_not_release_body(self):
        self.head.move({'pan':1,'tilt':-1,'slow':True},{1,2,3,5,6,7})
        before=len(self.board.releases)
        for _ in range(60):
            self.now+=20;self.head.step();self.head.status()
        self.assertEqual(len(self.board.releases),before)
        self.assertTrue(all(port in (9,10) for port,pulse in self.board.writes))
        self.assertLessEqual(max(p for _,p in self.board.writes),1700)

    def test_bad_limit_or_overlap_never_moves(self):
        for message,used in [({'pan':1},{8}),({'axis':'tilt','pulse':2500},set())]:
            with self.assertRaises(ValueError):self.head.move(message,used)
        self.assertEqual(self.board.writes,[])

    def test_timing_regular_ramp_and_idle_status(self):
        self.head.move({'pan':1},set())
        for _ in range(25):
            self.now+=20;self.head.step()
        measured=self.head.status()['timing']
        self.assertEqual(measured['updates'],25)
        self.assertEqual(measured['max_gap_ms'],20)
        self.assertEqual(measured['gap_sum_ms'],500)
        self.assertEqual(measured['gap_bins'],[0,25,0,0,0])
        self.assertEqual(measured['max_command_step_us'],8)
        self.assertEqual(measured['ramp_clamped_ms'],0)
        self.assertEqual(measured['completed_elapsed_ms'],500)
        self.now+=200;self.head.step()
        self.assertEqual(self.head.status()['timing'],measured,'settled holds must not inflate motion timing')
        with self.assertRaises(ValueError):self.head.move({'pan':2},set())
        self.assertEqual(self.head.status()['timing'],measured,'rejected commands preserve evidence')
        self.head.stop();self.assertEqual(self.head.status()['timing'],measured)

    def test_delayed_tick_does_not_make_a_catchup_jump(self):
        self.head.move({'pan':1},set())
        for dt in (20,100,20):
            self.now+=dt;self.head.step()
        measured=self.head.status()['timing']
        self.assertEqual(self.head.current['pan'],1524)
        self.assertEqual(measured['gap_bins'],[0,2,0,1,0])
        self.assertEqual(measured['max_gap_ms'],100)
        self.assertEqual(measured['ramp_clamped_ms'],80)
        self.assertEqual(measured['max_command_step_us'],8)
        self.assertIsNone(measured['completed_elapsed_ms'])
        self.head.move({'pan':0},set())
        self.assertEqual(self.head.status()['timing']['updates'],0)

    def test_two_axes_count_one_update_tick(self):
        self.head.move({'pan':1,'tilt':-1},set());self.now+=20;self.head.step()
        self.assertEqual(self.head.status()['timing']['updates'],1)
        self.assertEqual(self.head.current,{'pan':1508,'tilt':1492})

    def test_normal_speed_doubles_ramp_and_stays_after_completion(self):
        self.head.move({'pan':1},set())
        self.assertEqual(self.head.status()['speed_us_s'],400)
        self.now+=20;self.head.step()
        self.assertEqual(self.head.current['pan'],1508)
        for _ in range(30):
            self.now+=20;self.head.step();self.head.status()
        self.assertEqual(self.head.current['pan'],1700)
        self.assertEqual(self.head.speed,400)
        self.assertTrue(all(port==9 for port,_ in self.board.writes))

    def test_normal_speed_has_no_expiry(self):
        self.head.move({'pan':1},set())
        for _ in range(6):
            self.now+=1000;self.head.status()
        self.assertEqual(self.head.speed,400)
        self.assertEqual(self.board.writes,[])

    def test_normal_speed_survives_regular_move_stop_and_boot(self):
        for force in (False,True):
            self.head.move({'pan':1},set())
            self.head.stop(force=force)
            self.assertEqual(self.head.speed,400)
        self.head.move({'pan':1},set())
        self.head.move({'pan':0},set())
        self.assertEqual(self.head.speed,400)
        restored=PicoHead(self.channels,lambda:{'gimbal_pan':8,'gimbal_tilt':9})
        self.assertEqual(restored.speed,400)

    def test_head_fast_flag_and_raw_channel_are_capped(self):
        self.head.move({'pan':1,'slow':False},set())
        self.assertEqual(self.head.speed,400)
        self.head.stop()
        self.channels.channels[8]['group']='head'
        self.channels.move([{'channel':8,'pulse_us':1600}],speed=1600)
        self.assertEqual(self.channels.speed,150)

    def test_stop_and_expired_lease(self):
        self.head.move({'pan':1},set());self.now+=3100;self.head.step()
        self.assertFalse(self.head.targets)
        self.head.move({'tilt':1},set());self.channels.stop()
        self.assertFalse(self.head.targets)

    def test_walk_and_head_concurrent(self):
        self.gait.save(self.plan);self.gait.start(path_clear=True)
        self.head.move({'pan':1}, {1,2,3,5,6,7})
        for _ in range(50):
            self.tick();self.head.step();self.head.status()
        self.assertTrue(self.gait.running)
        self.assertTrue(any(port==9 for port,pulse in self.board.writes))

    def test_release_then_center_ramps_both_axes_from_last_output(self):
        self.head.move({'pan':1,'tilt':-1},set())
        for _ in range(80):
            self.now+=20;self.head.step();self.head.status()
        self.assertEqual(self.head.current,{'pan':1700,'tilt':1300})
        self.head.stop()
        state=self.head.status()
        self.assertFalse(state['holding']);self.assertEqual(state['commanded'],{})
        before=len(self.board.writes)
        self.now+=10000
        self.head.move({'pan':0,'tilt':0},set());self.head.step()
        self.assertEqual(len(self.board.writes),before,'acceptance must not spend idle time')
        self.now+=20;self.head.step()
        first=dict(self.board.writes[before:])
        self.assertGreaterEqual(first[9],1700-self.head.speed*0.04)
        self.assertLessEqual(first[10],1300+self.head.speed*0.04)
        for _ in range(80):
            self.now+=20;self.head.step();self.head.status()
        self.assertEqual(self.head.current,{'pan':1500,'tilt':1500})
        for port in (9,10):
            pulses=[p for ch,p in self.board.writes[before:] if ch==port]
            self.assertTrue(all(abs(a-b)<=self.head.speed*0.04 for a,b in zip(pulses,pulses[1:])))

    def test_interrupted_head_remembers_actual_last_command_not_target(self):
        self.head.move({'pan':1},set());self.now+=20;self.head.step()
        last=self.head.current['pan'];self.head.stop()
        self.head.move({'pan':0},set());self.now+=20;self.head.step()
        self.assertLessEqual(abs(self.head.current['pan']-last),self.head.speed*0.02)

    def test_changed_calibration_does_not_reuse_old_position_seed(self):
        self.head.move({'pan':1},set())
        for _ in range(80):
            self.now+=20;self.head.step();self.head.status()
        self.head.stop()
        self.channels.channels[8].update(a_us=1000,b_us=1400,center_us=1200)
        self.head.move({'pan':0},set());self.now+=20;self.head.step()
        self.assertEqual(self.head.current['pan'],1200)

    def _tilt_trace(self, start, target, cadence):
        # Hardware-free reproduction of Andrew's saved tilt range. Fresh state
        # makes the timing schedule exactly comparable in both directions.
        self.now=0;self.board.writes.clear()
        self.channels.channels[9].update(a_us=650,b_us=1060,center_us=855)
        head=PicoHead(self.channels,lambda:{'gimbal_pan':8,'gimbal_tilt':9})
        head.current={'pan':1500,'tilt':start};head.hold_enabled=True
        head.move({'axis':'tilt','pulse':target},set())
        trace=[]
        for index in range(1000):
            self.now+=cadence[index%len(cadence)]
            head.step();state=head.status()
            trace.append(state['commanded']['tilt'])
            self.assertEqual(state['commanded']['pan'],1500)
            self.assertTrue(state['holding'])
            self.assertTrue(650<=trace[-1]<=1060)
            if not state['moving']:break
        self.assertEqual(trace[-1],target)
        self.assertTrue(all(port in (9,10) for port,pulse in self.board.writes))
        return trace,state['timing']

    def test_saved_tilt_range_mirrors_in_both_directions(self):
        for cadence in [(20,),(21,22,24,31,12),(20,90,20,33)]:
            with self.subTest(cadence=cadence):
                increasing,inc_timing=self._tilt_trace(650,1060,cadence)
                decreasing,dec_timing=self._tilt_trace(1060,650,cadence)
                self.assertEqual(len(increasing),len(decreasing))
                self.assertEqual([1710-p for p in increasing],decreasing)
                self.assertEqual(inc_timing,dec_timing)

    def test_irregular_callbacks_keep_tilt_increment_bounded_to_one_period(self):
        trace,timing=self._tilt_trace(650,1060,(12,24,33))
        increments=[b-a for a,b in zip([650]+trace,trace)]
        self.assertEqual(increments[:3],[0,8,8])
        self.assertLessEqual(max(increments),8)
        self.assertGreater(timing['ramp_clamped_ms'],0)

    def test_first_step_never_spends_precommand_elapsed_time(self):
        self.now=100
        self.head.move({'tilt':1},set())
        self.now+=1;self.head.step()
        self.assertEqual(self.board.writes,[])
        self.now+=19;self.head.step()
        self.assertEqual(self.head.current['tilt'],1508)
        self.assertEqual(self.head.status()['timing']['start_delay_ms'],20)

    def test_deadline_poll_budget_and_early_callbacks(self):
        self.assertEqual(self.head.poll_delay_ms(),20)
        self.head.move({'tilt':1},set())
        self.now+=7
        self.assertEqual(self.head.poll_delay_ms(),13)
        self.head.step();self.assertEqual(self.board.writes,[])
        self.now+=13;self.assertEqual(self.head.poll_delay_ms(),0)
        self.head.step();self.assertEqual(self.head.current['tilt'],1508)
        self.assertEqual(self.head.poll_delay_ms(),20)
        before=len(self.board.writes);self.head.step()
        self.assertEqual(len(self.board.writes),before,'never burst replay missed PWM updates')

    def test_active_retargets_do_not_starve_the_output_clock(self):
        self.head.move({'tilt':1},set())
        for index in range(10):
            self.now+=10
            self.head.move({'tilt':1 if index%2 else .9},set())
            self.head.step()
        self.assertEqual(self.head.current['tilt'],1540)

    def test_completed_hold_does_not_rewrite_pwm(self):
        self.head.move({'tilt':1},set())
        for _ in range(25):self.now+=20;self.head.step()
        before=list(self.board.writes)
        for _ in range(20):self.now+=20;self.head.step();self.head.status()
        self.assertEqual(self.board.writes,before)
        self.assertTrue(self.head.status()['holding'])

if __name__=='__main__':unittest.main()
