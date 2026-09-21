"""Extract the actual dispatcher without importing Wi-Fi or starting hardware."""
import ast
import json
import unittest
from pathlib import Path
from test_named_gait import NamedWalkTests
from named_turn import NamedTurn
from stock_fanout import StockFanout

class DispatchTests(NamedWalkTests):
    def setUp(self):
        super().setUp()
        self.gait.save(self.plan);self.acks=[]
        self.stock=StockFanout(self.channels)
        self.channels.stop_stock=self.stock.stop
        source=(Path(__file__).resolve().parents[1]/"firmware/pico/relay_chip.py").read_text(encoding="utf8")
        fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=="_handle")
        self.env=dict(json=json,channels=self.channels,named_walk=self.gait,named_turn=NamedTurn(self.channels),
                      stock_fanout=self.stock,apply_pose=self.stock.pose,
                      _ack=lambda s,m,ok,**data:self.acks.append(dict(ok=ok,**data)))
        exec(compile(ast.Module(body=[fn],type_ignores=[]),"dispatcher","exec"),self.env)
    def send(self,**m):
        self.env["_handle"](None,json.dumps(m));return self.acks[-1]
    def test_voice_cycle_and_drive_use_named_executor(self):
        a=self.send(t="dog_cycle",f=.35,y=0)
        self.assertFalse(a["ok"]);self.assertFalse(self.gait.running)
        a=self.send(t="dog_cal",channel_action="walk_run",direction="forward",path_clear=True)
        self.assertTrue(a["ok"]);self.assertTrue(self.gait.running)
        run=self.gait.run_id;self.tick(30)
        a=self.send(t="dog_cal",channel_action="walk_run",direction="forward",path_clear=True)
        self.assertTrue(a["ok"]);self.assertEqual(self.gait.run_id,run)
    def test_manual_stop_aborts_named_walk(self):
        self.send(t="dog_cal",channel_action="walk_run",path_clear=True)
        self.tick(20);self.send(t="dog_cal",channel_action="stop")
        self.assertFalse(self.gait.running);self.assertFalse(self.channels.owning)
    def test_status_is_read_only_and_save_requires_idle(self):
        self.send(t="dog_cal",channel_action="info")
        self.assertEqual(self.board.writes,[])
        self.send(t="dog_cal",channel_action="walk_run",path_clear=True)
        a=self.send(t="dog_cal",channel_action="save",config=self.channels.channels[1])
        self.assertFalse(a["ok"]);self.assertTrue(self.gait.running)
    def test_stale_forward_fails_without_legacy_fallback(self):
        self.channels.channels[5]["enabled"]=False
        a=self.send(t="dog_cycle",f=1,y=0)
        self.assertFalse(a["ok"]);self.assertEqual(self.board.writes,[])

if __name__=="__main__":unittest.main()
