"""Exercise shared commands through the REAL dispatcher and gait executors."""
import unittest
import time
from unittest.mock import patch
import test_named_walk_dispatch as dispatch_fixture
import test_named_gait as gait_fixture
from shared_body import SharedBody
from pico_head import PicoHead


class SharedBodyTests(unittest.TestCase):
    tearDown = gait_fixture.NamedWalkTests.tearDown
    send = dispatch_fixture.DispatchTests.send

    def setUp(self):
        # DispatchTests.setUp uses super(), so invoke its bound fixture on an
        # actual DispatchTests instance, then share that isolated fake hardware.
        fixture = dispatch_fixture.DispatchTests()
        fixture.setUp()
        self.__dict__.update(fixture.__dict__)
        self.fixture = fixture
        for ch, name, a, b, au, bu in (
                (7, 'Turn', 'Closed', 'Open', 1515, 1019),
                (8, 'Pan', 'Left', 'Right', 500, 2500),
                (9, 'Tilt', 'Down', 'Up', 1060, 650)):
            self.channels.channels[ch].update(name=name, enabled=True, calibrated=True,
                a_name=a, b_name=b, a_us=au, b_us=bu, center_us=round((au+bu)/2))
        self.head = PicoHead(self.channels, lambda: {'gimbal_pan':8, 'gimbal_tilt':9})
        self.channels.stop_head = self.head.stop
        self.env.update(pico_head=self.head, shared_body=SharedBody(self.channels, self.head))

    def request(self, action, **args):
        return self.send(t='dog_cal', body_version=1, body_action=action, **args)

    def test_discovery_is_read_only_and_advertises_truth(self):
        before = self.head.received
        ack = self.request('status')
        self.assertTrue(ack['ok'])
        self.assertEqual(ack['body_contract']['version'], 1)
        self.assertTrue(ack['body_contract']['stock_two_leg_pose_compatible'])
        self.assertFalse(ack['body_contract']['stock_locomotion_verified'])
        self.assertEqual(self.board.writes, [])
        self.assertEqual(self.head.received, before)

    def test_same_walk_executor_for_old_and_new_clients(self):
        ack = self.request('walk', path_clear=True, pace='run', cycles=1)
        self.assertTrue(ack['ok']); self.assertEqual(self.gait.run_speed, 1600)
        run = self.gait.run_id
        legacy = self.send(t='dog_cal', channel_action='walk_run', path_clear=True)
        self.assertEqual(legacy['named_walk']['run_id'], run)
        self.assertTrue(self.request('stop')['ok'])
        self.assertFalse(self.gait.running)
        self.assertFalse(self.channels.owning)

    def test_client_cannot_smuggle_bench_bypass(self):
        ack = self.request('walk', path_clear=False, bench=True)
        self.assertFalse(ack['ok']); self.assertEqual(self.board.writes, [])

    def test_head_uses_saved_direction_and_slow_executor(self):
        ack = self.request('head', axis='tilt', position=1)
        self.assertTrue(ack['ok']); self.assertEqual(ack['state']['targets']['tilt'], 650)
        self.assertEqual(ack['state']['speed_us_s'], 150)
        self.assertTrue(self.request('head', axis='pan', position=-1)['ok'])
        self.assertEqual(self.head.targets['pan'], 500)
        self.request('stop'); self.assertFalse(self.head.targets)

    def test_turn_maps_observed_direction_and_ends_closed(self):
        ack = self.request('turn', direction='left', pattern_a_direction='right', fraction=.1)
        self.assertTrue(ack['ok'])
        turn = self.env['named_turn']
        self.assertEqual(turn.pattern, 'b')
        for _ in range(2000):
            self.fixture.now += 20
            if turn.running: turn.keepalive(turn.run_id)
            self.channels.step(); turn.step()
        self.assertFalse(turn.running); self.assertIsNone(turn.error)
        self.assertEqual(self.channels.current[7], 1515)

    def test_bad_commands_never_move(self):
        for action, args in (
                ('turn', dict(direction='left')),
                ('head', dict(axis='tilt', position=float('nan'))),
                ('head', dict(axis='tilt', position=True)),
                ('pose', {}), ('keepalive', dict(lane='other'))):
            self.assertFalse(self.request(action, **args)['ok'])
        self.assertFalse(self.send(t='dog_cal', body_version=99, body_action='walk')['ok'])
        self.assertEqual(self.board.writes, [])

    def test_continuous_walk_retains_lease_and_camera_protocol(self):
        ack = self.request('walk', path_clear=True, continuous=True)
        self.assertTrue(ack['ok']); run = ack['named_walk']['run_id']
        self.assertTrue(self.request('keepalive', lane='walk', run_id=run)['ok'])
        self.assertFalse(self.request('keepalive', lane='walk', run_id=run+1)['ok'])
        self.fixture.now += 3100
        self.gait.step()
        self.assertFalse(self.gait.running)

    def test_changed_walk_is_rejected_not_misreported(self):
        self.assertTrue(self.request('walk', path_clear=True, direction='forward')['ok'])
        ack = self.request('walk', path_clear=True, direction='backward')
        self.assertFalse(ack['ok']); self.assertEqual(self.gait.direction, 'forward')
        self.assertTrue(self.request('walk', path_clear=True, direction='forward')['ok'])

    def test_turn_during_walk_and_ambiguous_mapping_fail_without_new_motion(self):
        self.request('walk', path_clear=True)
        before = list(self.board.writes)
        self.assertFalse(self.request('turn', direction='left', pattern_a_direction='right')['ok'])
        self.assertEqual(before, self.board.writes)
        self.request('stop')
        self.channels.channels[10].update(self.channels.channels[7], channel=10)
        self.assertFalse(self.request('turn', direction='left', pattern_a_direction='right')['ok'])

    def test_preview_rejects_old_image_without_extending_run(self):
        ack = self.request('walk', path_clear=True, continuous=True)
        run = ack['named_walk']['run_id']
        self.fixture.now += 2600
        ack = self.request('preview', run_id=run, next_cycle=1, path_clear=True, capture_offset_ms=0)
        self.assertFalse(ack['ok'])
        self.assertEqual(self.gait.preview_cycle, -1)

    def test_fresh_preview_uses_capture_offset_since_original_ack(self):
        ack = self.request('walk', path_clear=True, continuous=True)
        run = ack['named_walk']['run_id']
        self.fixture.now = 1200
        with patch.object(time, 'ticks_add', lambda a,b:a+b, create=True):
            ack = self.request('preview', run_id=run, next_cycle=1,
                               path_clear=True, capture_offset_ms=1000)
        self.assertTrue(ack['ok'])
        self.assertEqual(self.gait.preview_deadline, 3500)

    def test_waiting_cycle_resumes_without_another_start(self):
        ack = self.request('walk', path_clear=True, continuous=True, pace='run')
        run = ack['named_walk']['run_id']
        for _ in range(4000):
            self.fixture.now += 20
            self.gait.keepalive(run)
            self.channels.step(); self.gait.step()
            if self.gait.waiting_for_vision: break
        self.assertTrue(self.gait.waiting_for_vision)
        count = self.gait.status()['completed_cycles']
        self.assertFalse(self.request('continue', run_id=run, completed_cycles=count+1, path_clear=True)['ok'])
        ack = self.request('continue', run_id=run, completed_cycles=count, path_clear=True)
        self.assertTrue(ack['ok']); self.assertFalse(self.gait.waiting_for_vision)
        self.assertEqual(self.gait.run_id, run)


if __name__ == '__main__': unittest.main()
