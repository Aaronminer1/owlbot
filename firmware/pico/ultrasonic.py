"""Opt-in HC-SR04 telemetry; no motor calls and no blocking echo wait.

This installation uses GP28 TRIG, GP21 ECHO on a powered Pico 2 W.
The original GP19/GP18 pair remains supported for existing configurations.
GP26/27/28 are NOT suitable for direct 5 V echo on this board; GP28 is
used only as a 3.3 V trigger OUTPUT. Both approved echo pins are FT inputs.
Direct 5 V ECHO is not portable to RP2040/Pico W; wire an appropriate
level shifter/divider on boards without powered 5 V-tolerant inputs.
Hard IRQ timestamps edges; only the 10 us trigger pulse delays the loop.
Sampling is best effort during network work, never a navigation guarantee.
"""
import machine
import time


class Ultrasonic:
    PERIOD_US = 100000  # 10 Hz, comfortably beyond the HC-SR04 echo window
    TIMEOUT_US = 30000
    STALE_MS = 1000

    def __init__(self):
        self.enabled = False
        self.reason = 'disabled'
        self.trig = self.echo = None
        self.trig_gp = self.echo_gp = None
        self.phase = 0  # 0 idle, 1 waiting rise, 2 waiting fall, 3 captured
        self.started = self.rise = self.fall = self.width = 0
        self.last_trigger = time.ticks_us()
        self.at_ms = None
        self.sequence = 0
        self.distance = None
        self.result = 'waiting'

    def enable(self, config):
        # Restrict to the two reviewed spare GPIO pairs, not arbitrary pins.
        # Reject strings, duplicates and servo pins without touching hardware.
        if config.get('enabled') is not True:
            return
        trig_gp, echo_gp = config.get('trig_gp'), config.get('echo_gp')
        if (type(trig_gp) is not int or type(echo_gp) is not int or
                (trig_gp, echo_gp) not in ((19, 18), (28, 21))):
            self.reason = 'unsupported_pins'
            return
        import os
        if 'RP2350' not in os.uname().machine:
            self.reason = 'board_not_validated'
            return
        try:
            self.trig_gp, self.echo_gp = trig_gp, echo_gp
            self.trig = machine.Pin(trig_gp, machine.Pin.OUT, value=0)
            self.echo = machine.Pin(echo_gp, machine.Pin.IN, machine.Pin.PULL_DOWN)
            self.echo.irq(handler=self._edge, trigger=machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING, hard=True)
            self.enabled = True
            self.reason = None
        except Exception:
            self.close()
            self.reason = 'sensor_init_failed'

    def _edge(self, pin):
        # Hard IRQ: pre-existing fields and small integers only. No lists,
        # logging, allocation, floating-point work, network or servo access.
        now = time.ticks_us()
        if self.phase == 1 and pin.value():
            self.rise = now
            self.phase = 2
        elif self.phase == 2 and not pin.value():
            self.width = time.ticks_diff(now, self.rise)
            self.fall = now
            self.phase = 3

    def _finish(self, result, distance, at_ms):
        self.result, self.distance, self.at_ms = result, distance, at_ms
        self.sequence = (self.sequence + 1) % 1000000

    def step(self):
        if not self.enabled:
            return
        now = time.ticks_us()
        # Snapshot/reset the IRQ state atomically. Never hold IRQs disabled
        # during an echo wait, pulse generation, JSON construction or I/O.
        irq = machine.disable_irq()
        phase, width, ended, started = self.phase, self.width, self.fall, self.started
        expired = phase in (1, 2) and time.ticks_diff(now, started) >= self.TIMEOUT_US
        if phase == 3 or expired:
            self.phase = 0
        machine.enable_irq(irq)
        if phase == 3:
            age_us = max(0, time.ticks_diff(now, ended))
            at = time.ticks_add(time.ticks_ms(), -(age_us // 1000))
            mm = (width * 343 + 1000) // 2000
            # Reject late pulses even if the loop was busy before consuming it.
            valid = 20 <= mm <= 4000 and 0 < time.ticks_diff(ended, started) <= self.TIMEOUT_US
            self._finish('echo' if valid else 'out_of_range', mm if valid else None, at)
        elif expired:
            self._finish('no_echo' if phase == 1 else 'echo_timeout', None, time.ticks_ms())
        if self.phase != 0 or time.ticks_diff(now, self.last_trigger) < self.PERIOD_US:
            return
        self.last_trigger = now
        if self.echo.value():
            self._finish('echo_stuck_high', None, time.ticks_ms())
            return
        self.started = time.ticks_us()
        self.phase = 1
        self.trig.value(1)
        time.sleep_us(10)
        self.trig.value(0)

    def status(self):
        age = None if self.at_ms is None else max(0, time.ticks_diff(time.ticks_ms(), self.at_ms))
        state = self.result if self.enabled else self.reason
        if self.enabled and age is not None and age > self.STALE_MS:
            state = 'stale'
        return {'version': 1, 'driver_revision': 2,
                'trig_gp': self.trig_gp, 'echo_gp': self.echo_gp,
                'enabled': self.enabled, 'status': state,
                'distance_mm': self.distance if state == 'echo' else None,
                'age_ms': age, 'sample': self.sequence,
                'axis': 'sensor_only', 'mount': 'unconfirmed'}

    def close(self):
        self.enabled = False
        self.phase = 0
        if self.echo:
            self.echo.irq(handler=None)
        if self.trig:
            self.trig.value(0)


def load(path='ultrasonic.json'):
    import json
    sensor = Ultrasonic()
    try:
        with open(path) as f:
            config = json.load(f)
        if isinstance(config, dict):
            sensor.enable(config)
        else:
            sensor.reason = 'invalid_config'
    except OSError:
        pass  # Other robots do not allocate GPIO unless explicitly configured.
    except Exception:
        sensor.close()
        sensor.reason = 'invalid_config'
    return sensor
