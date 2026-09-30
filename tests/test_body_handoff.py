"""Actual dispatcher, calibrated eight-servo fixtures; fake PWM only."""
from test_body_bow import BodyBowTests
from stock_body import StockBody


class BodyHandoffTests(BodyBowTests):
    def setUp(self):
        super().setUp()
        self.stock=StockBody(self.channels,self.gait)
        self.channels.stop_stock=self.stock.stop
        self.env.update(stock_fanout=self.stock,apply_pose=self.stock.pose)

    def seed_pose(self):
        for _ in range(30):
            self.fixture.now+=20
            self.stock.pose(102,78)
            self.channels.step();self.stock.step();self.head.step()
        self.assertTrue(self.stock.active)
        self.assertFalse(self.stock.walking)
        return dict(self.channels.current),len(self.board.releases)

    def test_bow_handoff_preserves_pulses_and_finishes(self):
        before,releases=self.seed_pose()
        a=self.command(8,pose_handoff='stock-pose-hold-v1')
        self.assertTrue(a['ok'],a)
        self.assertFalse(self.stock.active)
        self.assertTrue(self.channels.owning)
        self.assertEqual(self.channels.current,before)
        self.assertEqual(len(self.board.releases),releases)
        self.tick_command()
        self.assertTrue(self.commands.completed)
        self.assertEqual(len(self.board.releases),releases)

    def test_reverse_handoff_preserves_pulses_and_finishes(self):
        before,releases=self.seed_pose()
        a=self.send(t='dog_cal',channel_action='walk_run',direction='backward',cycles=1,
                    pace='run',path_clear=True,pose_handoff='stock-pose-hold-v1')
        self.assertTrue(a['ok'],a)
        self.assertEqual(self.channels.current,before)
        self.assertFalse(self.stock.active)
        for _ in range(600):
            self.fixture.now+=20;self.channels.step();self.gait.step();self.head.step()
        self.assertFalse(self.gait.running)
        self.assertEqual(self.gait.status()['completed_cycles'],1)
        self.assertEqual(len(self.board.releases),releases)

    def test_rejected_bow_restores_pose_without_release(self):
        before,releases=self.seed_pose();self.commands.config['enabled']=False
        a=self.command(8,pose_handoff='stock-pose-hold-v1')
        self.assertFalse(a['ok']);self.assertTrue(self.stock.active)
        self.assertEqual(self.stock.mode,'pose');self.assertTrue(self.channels.owning)
        self.assertEqual(self.channels.current,before)
        self.assertEqual(len(self.board.releases),releases)

    def test_bad_reverse_preserves_old_pose(self):
        before,releases=self.seed_pose()
        a=self.send(t='dog_cal',channel_action='walk_run',direction='backward',pace='invalid',
                    path_clear=True,pose_handoff='stock-pose-hold-v1')
        self.assertFalse(a['ok']);self.assertTrue(self.stock.active)
        self.assertEqual(self.channels.current,before)
        self.assertEqual(len(self.board.releases),releases)

    def test_legacy_request_still_refuses_live_stock_lane(self):
        before,releases=self.seed_pose()
        self.assertFalse(self.command(8)['ok'])
        self.assertEqual(self.channels.current,before)
        self.assertEqual(len(self.board.releases),releases)

    def test_live_walk_and_gesture_not_transferable(self):
        before,releases=self.seed_pose()
        self.stock.walking=True
        self.assertFalse(self.command(8,pose_handoff='stock-pose-hold-v1')['ok'])
        self.stock.walking=False;self.stock.mode='act'
        self.assertFalse(self.command(8,pose_handoff='stock-pose-hold-v1')['ok'])
        self.assertEqual(self.channels.current,before)
        self.assertEqual(len(self.board.releases),releases)

    def test_unknown_position_not_assumed(self):
        self.seed_pose();self.channels.current.pop(1)
        self.assertFalse(self.command(8,pose_handoff='stock-pose-hold-v1')['ok'])
        self.assertTrue(self.stock.active)

    def test_discovery_and_stop_unchanged(self):
        self.assertEqual(self.send(t='dog_cal',channel_action='info')['pose_handoff'],'stock-pose-hold-v1')
        self.seed_pose();self.command(8,pose_handoff='stock-pose-hold-v1')
        self.send(t='stop');self.assertFalse(self.commands.active)
        self.assertEqual(self.commands.error,'bow_cancelled')
