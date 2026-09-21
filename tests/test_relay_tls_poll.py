"""Ensure pending decrypted frames are polled, not only raw network bytes."""
import ast
from pathlib import Path
import unittest

class TLSReceiveTests(unittest.TestCase):
    def test_poll_registers_tls_stream(self):
        source=(Path(__file__).resolve().parents[1]/'firmware/pico/relay_chip.py').read_text()
        fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='serve')
        tls,raw=object(),object()
        class Captured(Exception): pass
        class Poll:
            def register(inner,stream,flags):
                self.assertIs(stream,tls,'Raw socket can miss buffered TLS frames')
                raise Captured()
        class Select:
            POLLIN=1
            @staticmethod
            def poll():return Poll()
        env={'select':Select,'LINK_DIAG':{'connections':0}}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'serve','exec'),env)
        with self.assertRaises(Captured):env['serve'](tls,raw)

if __name__=='__main__':unittest.main()
