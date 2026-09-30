"""Real dispatcher/servo lanes with fake time and PWM, never live hardware."""
import unittest
import test_stock_commands as fixtures
from stock_commands import frames, decode, named_opcode


class BodyBowTests(unittest.TestCase):
    tearDown = fixtures.StockCommandTests.tearDown
    send = fixtures.StockCommandTests.send
    request = fixtures.StockCommandTests.request
    command = fixtures.StockCommandTests.command
    tick_command = fixtures.StockCommandTests.tick_command

    def setUp(self):
        fixture = fixtures.StockCommandTests()
        fixture.setUp()
        self.__dict__.update(fixture.__dict__)
        for ch,name,up,down in (
                (1,'Left front leg',1561,1112),(5,'Right front leg',1215,1734),
                (2,'Left rear leg',2500,1960),(3,'Right rear leg',935,1113)):
            self.channels.channels[ch].update(name=name,a_us=up,b_us=down,
                a_name='Up',b_name='Down',center_us=round((up+down)/2))
        self.gait.plan['steps']=[self.fixture.bound(ch,p) for ch,p in self.fixture.order]
        self.head.hold_enabled=True

    def test_body_bow_roundtrip_and_existing_frames_unchanged(self):
        self.assertEqual(decode(frames(8)),8)
        self.assertEqual(named_opcode('take a bow'),8)
        for op in range(1,8):
            self.assertEqual(decode(frames(op)),op)
        bad=frames(8);bad[-1]['l']+=1
        self.assertFalse(self.send(t='act',steps=bad,mode='replace')['ok'])
        self.assertEqual(self.board.writes,[])

    def test_fronts_and_head_lower_and_rise_in_same_phases(self):
        self.assertTrue(self.command(8)['ok'])
        phases=[];first={};snapshots={}
        while self.commands.active:
            n=len(self.board.writes);self.tick_command(1)
            b=self.commands.bow
            if not phases or phases[-1]!=b.phase:
                phases.append(b.phase)
                snapshots[b.phase]=(list(self.channels.queue),dict(self.head.targets))
            for port,pulse in self.board.writes[n:]:first.setdefault(port,pulse)
            self.assertLess(self.fixture.now,8000)
        self.assertEqual(phases,['support','lower','hold','rise','completed'])
        self.assertEqual(first[2],1112)  # directly engage Down, not midpoint
        self.assertEqual(first[6],1734)
        self.assertEqual(snapshots['lower'][0],[(1,1292),(5,1526)])
        self.assertEqual(snapshots['lower'][1]['tilt'],947)
        self.assertEqual(self.commands.bow.status()['front_fraction'],0.40)
        self.assertEqual(self.commands.bow.status()['head_fraction'],0.45)
        self.assertEqual(snapshots['rise'][0],[(1,1112),(5,1734)])
        self.assertEqual(snapshots['rise'][1]['tilt'],855)
        self.assertTrue(self.commands.completed)
        self.assertIsNone(self.commands.error)
        self.assertEqual(self.head.current['tilt'],855)
        self.assertEqual(self.head.speed,400)
        self.assertTrue(self.head.targets)
        self.assertEqual({ch:self.channels.current[ch] for ch in (1,5,2,3)},
                         {1:1112,5:1734,2:1960,3:1113})
        self.assertTrue(all(port in (2,6,3,4,9,10) for port,pulse in self.board.writes))
        for port,down in ((3,1960),(4,1113)):
            self.assertEqual(set(p for c,p in self.board.writes if c==port),{down})

    def test_bad_binding_or_unsupported_head_no_output(self):
        self.head.hold_enabled=False
        self.assertFalse(self.command(8)['ok']);self.assertEqual(self.board.writes,[])
        self.head.hold_enabled=True
        self.channels.channels[1]['a_us']+=1
        self.assertFalse(self.command(8)['ok']);self.assertEqual(self.board.writes,[])

    def test_stop_mid_bow_never_runs_rise(self):
        self.assertTrue(self.command(8)['ok'])
        while self.commands.bow.phase!='lower':self.tick_command(1)
        self.tick_command(5)
        self.send(t='stop');n=len(self.board.writes)
        self.tick_command(600)
        self.assertFalse(self.commands.active)
        self.assertFalse(self.commands.completed)
        self.assertEqual(self.commands.error,'bow_cancelled')
        self.assertEqual(len(self.board.writes),n)
        self.assertTrue(self.head.targets)

    def test_stalled_bow_deadline_cancels(self):
        self.assertTrue(self.command(8)['ok'])
        self.fixture.now+=8001;self.commands.step()
        self.assertEqual(self.commands.error,'bow_execution_timeout')
        self.assertFalse(self.commands.completed)
        self.assertFalse(self.channels.queue)

    def test_read_only_polling_does_not_preempt(self):
        self.assertTrue(self.command(8)['ok'])
        while self.commands.active:
            self.send(t='dog_cal',channel_action='info')
            self.send(t='dog_cal',channel_action='head_info')
            self.tick_command(1)
        self.assertTrue(self.commands.completed)

    def test_new_head_request_cancels_bow_without_delayed_rise(self):
        self.assertTrue(self.command(8)['ok'])
        while self.commands.bow.phase!='lower':self.tick_command(1)
        self.tick_command(4)
        self.assertTrue(self.request('head',axis='pan',position=0.1)['ok'])
        leg_count=len([w for w in self.board.writes if w[0] not in (9,10)])
        self.tick_command(600)
        self.assertEqual(len([w for w in self.board.writes if w[0] not in (9,10)]),leg_count)
        self.assertFalse(self.commands.completed)

    def test_second_bow_is_blocked_and_does_not_restart(self):
        self.assertTrue(self.command(8)['ok']);run=self.commands.run_id
        self.assertFalse(self.command(8)['ok']);self.assertEqual(self.commands.run_id,run)

if __name__=='__main__':unittest.main()
