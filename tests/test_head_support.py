"""Load-bearing head support across real dispatch/body lane transitions."""
import ast
import unittest
from pathlib import Path
from test_stock_body import StockBodyTests
from pico_head import PicoHead
from shared_body import SharedBody
from stock_commands import StockCommands, frames


class HeadSupportTests(unittest.TestCase):
    def setUp(self):
        self.fixture=StockBodyTests();self.fixture.setUp()
        self.f=self.fixture.f;self.channels=self.f.channels;self.board=self.f.board
        self.stock=self.fixture.stock
        for ch,name,a,b,au,bu in ((8,'Pan','Left','Right',500,2500),
                                (9,'Tilt','Down','Up',1060,650)):
            self.channels.channels[ch].update(name=name,group='head',enabled=True,
                calibrated=True,a_name=a,b_name=b,a_us=au,b_us=bu,center_us=round((au+bu)/2))
        self.head=PicoHead(self.channels,self.channels.gaze.ports_dict)
        self.head.hold_enabled=True
        self.channels.stop_head=self.head.stop
        shared=SharedBody(self.channels,self.head)
        self.commands=StockCommands(self.channels,self.f.gait,self.f.env['named_turn'],
            self.head,shared,dict(enabled=True,pattern_a_direction='right',turn_fraction=.6))
        self.f.env.update(pico_head=self.head,shared_body=shared,stock_commands=self.commands)

    def tearDown(self):self.fixture.tearDown()

    def tick(self,n=1):
        for _ in range(n):
            self.f.now+=20;self.channels.step();self.commands.step()
            self.f.env['named_turn'].step();self.head.step();self.stock.step()

    def engage(self):
        self.assertTrue(self.f.send(t='act',steps=frames(7),mode='replace')['ok'])
        self.tick(260)
        self.assertTrue(self.commands.completed)
        self.assertEqual(self.head.targets,{'pan':1500,'tilt':855})
        self.assertEqual(self.board.retained_servo_ports,{9,10})

    def test_boot_and_status_do_not_engage(self):
        self.head.status();self.commands.status()
        self.assertEqual(self.board.writes,[])
        self.assertFalse(self.head.targets)
        self.assertEqual(self.board.retained_servo_ports,set())

    def test_completed_head_gesture_holds_without_renewals_or_body_outputs(self):
        self.engage();before=list(self.board.writes)
        self.tick(1000)
        self.assertEqual(self.board.writes,before)
        self.assertTrue(self.head.status()['static_hold'])
        self.assertFalse(set(self.board.releases)&{9,10})

    def test_motion_stop_freezes_in_place_but_explicit_release_stays_released(self):
        self.f.send(t='act',steps=frames(3),mode='replace');self.tick(25)
        last=dict(self.head.current)
        ack=self.f.send(t='stop');self.assertTrue(ack['holding'])
        self.assertEqual(self.head.targets,last)
        before=list(self.board.writes);self.tick(200)
        self.assertEqual(self.board.writes,before)
        self.f.send(t='dog_cal',channel_action='head_stop')
        self.assertEqual(self.board.retained_servo_ports,set())
        self.assertFalse(self.head.targets)
        before=list(self.board.writes);self.tick(500)
        self.assertEqual(self.board.writes,before)

    def test_walk_starts_with_both_axes_supported_and_keeps_them_after_stop(self):
        import math
        for i in range(500):
            a=30*math.sin(i*math.pi/18)
            self.f.send(t='pose',lr='%s,%s'%(90+a,90+a),rid=i+1);self.tick()
            if i==0:self.board.releases=[]  # initial all-off happened before engagement
        self.assertTrue(self.stock.walking)
        self.assertGreater(self.stock.completed_cycles,0)
        self.assertEqual(self.board.retained_servo_ports,{9,10})
        self.assertFalse(set(self.board.releases)&{9,10})
        self.f.send(t='stop')
        self.assertFalse(self.stock.walking)
        self.assertTrue(self.head.targets)
        self.assertFalse(set(self.board.releases)&{9,10})

    def test_turn_completion_does_not_drop_head(self):
        self.engage()
        for op in (1,2):
            self.assertTrue(self.f.send(t='act',steps=frames(op),mode='replace')['ok'])
            self.tick(260)
            self.assertTrue(self.commands.completed)
            self.assertTrue(self.commands.return_closed)
            self.assertTrue(self.head.targets)
        self.assertFalse(set(self.board.releases)&{9,10})

    def test_all_release_and_channel_stop_override_support(self):
        for packet in (dict(t='release'),dict(t='gaze_release'),
                       dict(t='dog_cal',channel_action='stop')):
            self.engage();self.f.send(**packet)
            self.assertFalse(self.head.targets)
            self.assertFalse(self.board.retained_servo_ports)
            before=list(self.board.writes);self.tick(50)
            self.assertEqual(self.board.writes,before)

    def test_head_lease_expiry_freezes_not_continues_or_collapses(self):
        self.head.move({'pan':1},set());self.tick(10)
        last=dict(self.head.current);self.f.now+=3100;self.head.step()
        self.assertEqual(self.head.targets,last)
        self.assertTrue(self.head.static_hold)
        self.assertFalse(set(self.board.releases)&{9,10})

    def test_single_axis_explicit_release_preserves_other_axis(self):
        self.engage();self.head.release_axis('tilt')
        self.assertEqual(self.board.retained_servo_ports,{9})
        self.assertEqual(self.head.targets,{'pan':1500})


class ActualDriverReleaseTests(unittest.TestCase):
    def test_driver_respects_retained_ports_and_explicit_force(self):
        source=(Path(__file__).resolve().parents[1]/'firmware/pico/PicoRobotics.py').read_text()
        cls=next(n for n in ast.parse(source).body if isinstance(n,ast.ClassDef) and n.name=='KitronikPicoRobotics')
        cls.body=[n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name in ('release','releaseAll')]
        env={};exec(compile(ast.Module(body=[cls],type_ignores=[]),'driver','exec'),env)
        class PWM:
            def __init__(self):self.value=42
            def duty_u16(self,value):self.value=value
        b=env['KitronikPicoRobotics']();b.mode='direct';b._ports=range(1,17)
        b._pwm={p:PWM() for p in b._ports};b._last={};b._last_t={}
        b.retained_servo_ports={9,10};b.releaseAll()
        self.assertEqual({p for p,v in b._pwm.items() if v.value==42},{9,10})
        b.releaseAll(force=True)
        self.assertFalse(b.retained_servo_ports)
        self.assertTrue(all(v.value==0 for v in b._pwm.values()))

if __name__=='__main__':unittest.main()
