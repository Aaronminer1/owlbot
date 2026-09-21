"""Execute the real main() recovery path without a board or network."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE=(Path(__file__).resolve().parents[1]/'firmware/pico/main.py').read_text()
FN=next(n for n in ast.parse(SOURCE).body if isinstance(n,ast.FunctionDef) and n.name=='main')

class End(Exception): pass

class RecoveryTests(unittest.TestCase):
    def test_cancel_and_hold_precede_radio_reset_and_no_motion_is_replayed(self):
        events=[];diag={'failures':0,'reset_radio':False}
        def event(name):return lambda *a,**kw:events.append(name)
        engine=SimpleNamespace(cancel=event('cancel'),stop=event('hold'),owning=True,_enabled=True)
        sock=SimpleNamespace(close=event('close_socket'))
        def serve(*a):
            diag['reset_radio']=True
            events.append('receive_deadline')
        def sleep(ms):
            if events:raise End()
        env=dict(_wdt=object(),LINK_DIAG=diag,
            time=SimpleNamespace(ticks_ms=lambda:0,ticks_diff=lambda a,b:a-b),
            sleep_fed=sleep,ensure_wifi=lambda:True,ws_open=lambda:(sock,sock),
            serve=serve,radio_reset_required=lambda fails:diag['reset_radio'],
            wifi_reset=event('radio_reset'),HARD_RESET_AFTER=10,print=lambda *a:None,
            **{n:engine for n in ('stock_commands','pico_head','stock_fanout',
                'named_turn','named_walk','channels','dog')})
        exec(compile(ast.Module(body=[FN],type_ignores=[]),'actual main','exec'),env)
        with self.assertRaises(End):env['main']()
        self.assertIn('cancel',events)
        self.assertIn('hold',events)
        self.assertGreater(events.index('radio_reset'),max(i for i,e in enumerate(events) if e in ('cancel','hold')))
        self.assertEqual(diag['failures'],1)
        self.assertFalse(diag['reset_radio'])

if __name__=='__main__':unittest.main()
