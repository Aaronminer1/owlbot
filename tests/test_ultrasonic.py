"""Desktop simulation of timing/IRQ/error states, not physical accuracy proof."""
import ast
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

FW = pathlib.Path(__file__).resolve().parents[1] / 'firmware' / 'pico'

class Tests(unittest.TestCase):
    def setUp(self, pins=(28,21)):
        self.us = 0
        self.pins = {}
        self.delays = []
        self.trig_gp, self.echo_gp = pins
        owner = self
        class Pin:
            IN, OUT, PULL_DOWN, IRQ_RISING, IRQ_FALLING = range(5)
            def __init__(self, number, mode, pull=None, value=0):
                self.v, self.handler = value, None
                owner.pins[number] = self
            def irq(self, handler=None, **kwargs): self.handler = handler
            def value(self, value=None):
                if value is not None: self.v = value
                return self.v
        clock = types.SimpleNamespace(ticks_us=lambda:self.us, ticks_ms=lambda:self.us//1000,
            ticks_diff=lambda a,b:((a-b+(1<<29))%(1<<30))-(1<<29),
            ticks_add=lambda a,b:(a+b)%(1<<30), sleep_us=self.delays.append)
        machine = types.SimpleNamespace(Pin=Pin,disable_irq=lambda:0,enable_irq=lambda _:None)
        system = types.SimpleNamespace(uname=lambda:types.SimpleNamespace(machine='Pico 2 W RP2350'))
        spec = importlib.util.spec_from_file_location('ultrasonic', FW/'ultrasonic.py')
        self.mod = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'machine':machine, 'time':clock, 'os':system}):
            spec.loader.exec_module(self.mod)
            self.s = self.mod.Ultrasonic()
            self.s.enable({'enabled':True,'trig_gp':self.trig_gp,'echo_gp':self.echo_gp})
    def trigger(self): self.us += 100000; self.s.step()
    def edge(self, value, advance):
        self.us += advance; p=self.pins[self.echo_gp]; p.v=value; p.handler(p)
    def test_echo_no_wait_and_only_spare_pins(self):
        self.trigger(); self.edge(1, 100); self.edge(0, 5800); self.s.step()
        self.assertEqual(self.s.status()['distance_mm'],995)
        self.assertEqual(set(self.pins),{28,21}); self.assertEqual(self.delays,[10])
        self.assertEqual(self.s.status()['trig_gp'],28)
        self.assertEqual(self.s.status()['echo_gp'],21)
        self.assertEqual(self.s.status()['driver_revision'],2)
    def test_original_pair_remains_compatible(self):
        self.setUp((19,18));self.trigger();self.edge(1,100);self.edge(0,5800);self.s.step()
        self.assertEqual(self.s.status()['distance_mm'],995)
        self.assertEqual(set(self.pins),{19,18})
    def test_no_echo_and_high_timeout_unknown(self):
        for rise, expected in [(False,'no_echo'),(True,'echo_timeout')]:
            self.setUp(); self.trigger()
            if rise:self.edge(1,100)
            self.us += 30000; self.s.step()
            self.assertEqual(self.s.status()['status'],expected)
            self.assertIsNone(self.s.status()['distance_mm'])
    def test_stuck_high_does_not_trigger(self):
        self.pins[self.echo_gp].v=1; self.trigger()
        self.assertEqual(self.s.status()['status'],'echo_stuck_high');self.assertFalse(self.delays)
    def test_stale_and_delayed_consumption(self):
        self.trigger(); self.edge(1,100); self.edge(0,5800)
        self.us += 1100000; self.s.step()
        self.assertEqual(self.s.status()['status'],'stale');self.assertIsNone(self.s.status()['distance_mm'])
    def test_late_and_out_of_range_pulse(self):
        for duration in [10,25000,35000]:
            self.setUp();self.trigger();self.edge(1,100);self.edge(0,duration);self.s.step()
            self.assertEqual(self.s.status()['status'],'out_of_range')
    def test_gpio_validation_before_access(self):
        for trig,echo in [(0,18),(28,26),(28,27),(28,28),(21,28),('28',21),(28,'21'),(True,21)]:
            s=self.mod.Ultrasonic();self.pins.clear()
            s.enable({'enabled':True,'trig_gp':trig,'echo_gp':echo})
            self.assertFalse(self.pins);self.assertEqual(s.reason,'unsupported_pins')
    def test_disabled_default(self):
        s=self.mod.Ultrasonic();s.step();self.assertEqual(s.status()['status'],'disabled')
    def test_close_removes_irq(self):
        self.s.close();self.assertIsNone(self.pins[self.echo_gp].handler);self.assertFalse(self.s.enabled)
    def test_range_dispatch_has_no_actuator_dependencies(self):
        tree=ast.parse((FW/'relay_chip.py').read_text(encoding='utf-8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_handle')
        calls=[]
        env={'json':__import__('json'),'sonar':self.s,'_ack':lambda *a,**kw:calls.append(kw)}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'<handler>','exec'),env)
        result=env['_handle'](None,'{"t":"dog_cal","channel_action":"range_info","rid":"test"}')
        self.assertEqual(result,'info');self.assertEqual(calls[0]['ultrasonic']['version'],1)
        # No motors/engines/globals are provided: even looking them up fails.

if __name__=='__main__': unittest.main()
