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

    def test_head_fast_flag_and_raw_channel_are_capped(self):
        self.head.move({'pan':1,'slow':False},set())
        self.assertEqual(self.head.speed,150)
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
        first=dict(self.board.writes[before:])
        self.assertGreaterEqual(first[9],1694)
        self.assertLessEqual(first[10],1306)
        for _ in range(80):
            self.now+=20;self.head.step();self.head.status()
        self.assertEqual(self.head.current,{'pan':1500,'tilt':1500})
        for port in (9,10):
            pulses=[p for ch,p in self.board.writes[before:] if ch==port]
            self.assertTrue(all(abs(a-b)<=6 for a,b in zip(pulses,pulses[1:])))

    def test_interrupted_head_remembers_actual_last_command_not_target(self):
        self.head.move({'pan':1},set());self.now+=20;self.head.step()
        last=self.head.current['pan'];self.head.stop()
        self.head.move({'pan':0},set());self.now+=20;self.head.step()
        self.assertLessEqual(abs(self.head.current['pan']-last),3)

    def test_changed_calibration_does_not_reuse_old_position_seed(self):
        self.head.move({'pan':1},set())
        for _ in range(80):
            self.now+=20;self.head.step();self.head.status()
        self.head.stop()
        self.channels.channels[8].update(a_us=1000,b_us=1400,center_us=1200)
        self.head.move({'pan':0},set());self.now+=20;self.head.step()
        self.assertEqual(self.head.current['pan'],1200)

if __name__=='__main__':unittest.main()
