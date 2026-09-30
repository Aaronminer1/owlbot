"""PicoRobotics - GrowBot board driver (drop-in replacement, API-compatible).

Same public API as the stock GrowBot driver, so existing code keeps working:

    board = KitronikPicoRobotics()      # auto-detects whatever you have
    board.servoWrite(1, 90)             # port 1 = LEFT leg
    board.servoWrite(3, 90)             # port 3 = RIGHT leg
    board.release(1)                    # go limp

Board detection, in order:
  1. PCA9685 over I2C on GP8/GP9 - Kitronik Robotics Board (5329) at 0x6C,
     or a generic PCA9685 breakout at 0x40.
  2. Direct hardware PWM on GP0 (left) / GP1 (right).
     This is the path the Waveshare Pico Servo Driver takes. That board
     carries NO I2C chip at all - its silkscreen socket numbers ARE the GPIO
     numbers, so socket 0 = left leg = GP0 and socket 1 = right leg = GP1.
     Direct PWM is NOT a degraded mode: both paths are hardware PWM at 50 Hz.

What this version adds over the stock driver
--------------------------------------------
* ``servoWriteMicros()`` - write raw pulse width, so calibration can correct
  for servos whose real 0-180 sweep is not exactly 500-2500 us.
* Per-port trim/invert/range calibration (``set_calibration``), applied inside
  the driver so every caller benefits.
* ``set_slew_limit()`` - caps degrees-per-second at the driver level. Servo
  inrush current rises with commanded step size, so limiting slew is the
  cheapest software mitigation for the brownouts that are the #1 reliability
  problem on a 4xAA build.
* ``supply_volts()`` - reads VSYS through ADC3. Lets the robot report a
  sagging pack instead of just mysteriously resetting.
* ``last_write()`` - what was actually commanded, for telemetry.

Written to sit alongside the GrowBot project (CC BY-NC 4.0 upstream) -
keep credit to Art of the Problem.
"""

from machine import Pin, PWM, I2C, ADC
import time

# ---------------------------------------------------------------- constants

PCA9685_ADDRESSES = (0x6C, 0x40, 0x41, 0x42, 0x43)  # Kitronik first
I2C_SDA_PIN = 8
I2C_SCL_PIN = 9
I2C_FREQ = 100_000

# PCA9685 registers
_MODE1 = 0x00
_PRESCALE = 0xFE
_LED0_ON_L = 0x06  # each channel is 4 bytes: ON_L, ON_H, OFF_L, OFF_H

SERVO_FREQ_HZ = 50
PERIOD_US = 1_000_000 // SERVO_FREQ_HZ  # 20000 us

# Default pulse widths. Most MG90S/SG90 land close to this; calibrate if not.
DEFAULT_MIN_US = 500
DEFAULT_MAX_US = 2500

# Logical leg ports (kept identical to stock GrowBot: 1 = left, 3 = right)
PORT_LEFT = 1
PORT_RIGHT = 3

# Direct-wire profiles. Waveshare socket numbers == GPIO numbers.  The profile
# keeps the established two-servo mapping intact while letting the dog use six
# consecutive sockets without changing the public driver API.
DIRECT_PIN_PROFILES = {
    "growbot2": {PORT_LEFT: 0, PORT_RIGHT: 1},
    # Ports 7/8 reserve GP6/GP7 for the optional pan/tilt phone gimbal.
    # They initialize limp and are never touched by DogEngine.
    "dog6": {port: port-1 for port in range(1,17)},
}
DIRECT_PINS = DIRECT_PIN_PROFILES["growbot2"]


def _clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


class _PortCal:
    """Per-servo calibration. Everything the walk needs to be symmetric."""

    __slots__ = ("min_us", "max_us", "trim_deg", "invert", "lo_deg", "hi_deg")

    def __init__(self):
        self.min_us = DEFAULT_MIN_US
        self.max_us = DEFAULT_MAX_US
        self.trim_deg = 0.0      # added after invert; corrects a crooked horn
        self.invert = False      # mirror the sweep for a flipped servo
        self.lo_deg = 0.0        # software travel limits
        self.hi_deg = 180.0

    def to_us(self, deg):
        d = 180.0 - deg if self.invert else deg
        d = _clamp(d + self.trim_deg, self.lo_deg, self.hi_deg)
        span = self.max_us - self.min_us
        return int(self.min_us + (d / 180.0) * span)


class KitronikPicoRobotics:
    """Board abstraction. Name kept for drop-in compatibility."""

    def __init__(self, i2c=None, address=None, verbose=True, profile="growbot2"):
        self.mode = "unknown"
        self.profile = profile if profile in DIRECT_PIN_PROFILES else "growbot2"
        self._direct_pins = DIRECT_PIN_PROFILES[self.profile]
        self._ports = tuple(sorted(self._direct_pins.keys()))
        self.address = None
        self.i2c = None
        self._pwm = {}
        self._cal = {port: _PortCal() for port in self._ports}
        self._last = {}          # port -> last commanded degrees
        self._last_t = {}        # port -> ticks_ms of last write
        self._slew_dps = 0.0     # 0 = unlimited
        self._vsys = None
        # An opt-in load-bearing head can retain PWM across body-lane stops.
        # Empty by default; explicit head/all release clears this ownership.
        self.retained_servo_ports = set()

        self._detect(i2c, address, verbose)
        self._init_vsys()

    # ------------------------------------------------------------ detection

    def _detect(self, i2c, address, verbose):
        bus = None
        found = []
        try:
            bus = i2c or I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN),
                             freq=I2C_FREQ)
            found = bus.scan()
        except Exception:
            found = []
            bus = None

        candidates = (address,) if address else PCA9685_ADDRESSES
        for addr in candidates:
            if addr is not None and addr in found:
                self.i2c = bus
                self.address = addr
                self.mode = "pca9685"
                self._init_pca9685()
                if verbose:
                    print("BOARD pca9685 @ 0x%02X" % addr)
                return

        # No I2C servo chip. Direct hardware PWM (Waveshare / breadboard).
        self.mode = "direct"
        for port, gpio in self._direct_pins.items():
            pwm = PWM(Pin(gpio))
            pwm.freq(SERVO_FREQ_HZ)
            pwm.duty_u16(0)  # idle = no pulse = limp
            self._pwm[port] = pwm
        if verbose:
            if self.profile == "dog6":
                print("BOARD Waveshare direct GP0..GP15 (16 channels)")
            else:
                print("BOARD direct GP%d=left GP%d=right"
                      % (self._direct_pins[PORT_LEFT], self._direct_pins[PORT_RIGHT]))

    def _init_pca9685(self):
        # Sleep, set prescale for 50 Hz, wake, enable auto-increment.
        prescale = int(round(25_000_000.0 / (4096 * SERVO_FREQ_HZ)) - 1)
        self.i2c.writeto_mem(self.address, _MODE1, bytes([0x10]))  # sleep
        time.sleep_us(500)
        self.i2c.writeto_mem(self.address, _PRESCALE, bytes([prescale]))
        self.i2c.writeto_mem(self.address, _MODE1, bytes([0x00]))  # wake
        time.sleep_us(500)
        self.i2c.writeto_mem(self.address, _MODE1, bytes([0xA0]))  # AI + RESTART

    def _init_vsys(self):
        """VSYS sense on ADC3. Approximate on the W (pin is shared with the
        wireless chip) but good enough to tell fresh cells from a dying pack."""
        try:
            self._vsys = ADC(3)
        except Exception:
            self._vsys = None

    # ------------------------------------------------------- calibration API

    def set_calibration(self, port, min_us=None, max_us=None, trim_deg=None,
                        invert=None, lo_deg=None, hi_deg=None):
        cal = self._cal.get(port)
        if cal is None:
            cal = self._cal[port] = _PortCal()
        if min_us is not None:
            cal.min_us = int(min_us)
        if max_us is not None:
            cal.max_us = int(max_us)
        if trim_deg is not None:
            cal.trim_deg = float(trim_deg)
        if invert is not None:
            cal.invert = bool(invert)
        if lo_deg is not None:
            cal.lo_deg = float(lo_deg)
        if hi_deg is not None:
            cal.hi_deg = float(hi_deg)

    def calibration(self):
        out = {}
        for port, c in self._cal.items():
            out[port] = {"min_us": c.min_us, "max_us": c.max_us,
                         "trim": c.trim_deg, "invert": c.invert,
                         "lo": c.lo_deg, "hi": c.hi_deg}
        return out

    def set_slew_limit(self, deg_per_sec):
        """Cap commanded change rate. 0 disables. ~900 dps is a sane start:
        fast enough for a 30 Hz walk, slow enough to blunt the current spike."""
        self._slew_dps = float(deg_per_sec or 0)

    # ------------------------------------------------------------ motion API

    def servoWrite(self, port, degrees):
        """Command a leg angle. 90 = straight out. Returns the applied angle."""
        deg = float(degrees)
        now = time.ticks_ms()

        if self._slew_dps > 0:
            prev = self._last.get(port)
            prev_t = self._last_t.get(port)
            if prev is not None and prev_t is not None:
                dt = time.ticks_diff(now, prev_t) / 1000.0
                if dt <= 0:
                    dt = 0.001
                max_step = self._slew_dps * dt
                delta = deg - prev
                if delta > max_step:
                    deg = prev + max_step
                elif delta < -max_step:
                    deg = prev - max_step

        cal = self._cal.get(port)
        if cal is None:
            cal = self._cal[port] = _PortCal()
        self._write_us(port, cal.to_us(deg))
        self._last[port] = deg
        self._last_t[port] = now
        return deg

    def servoWriteMicros(self, port, micros):
        """Bypass the degree mapping. For calibration sweeps."""
        us = int(_clamp(micros, 400, 2600))
        self._write_us(port, us)
        return us

    def release(self, port, force=False):
        """Release unless a load-bearing head owns this port; force is explicit."""
        if not force and port in self.retained_servo_ports:
            return
        if force:
            self.retained_servo_ports.discard(port)
        if self.mode == "direct":
            pwm = self._pwm.get(port)
            if pwm:
                pwm.duty_u16(0)
        else:
            self._pca_raw(port, 0, 0)
        self._last.pop(port, None)
        self._last_t.pop(port, None)

    def releaseAll(self, force=False):
        for port in self._ports:
            try:
                self.release(port, force=force)
            except Exception:
                pass

    def legs(self, left_deg, right_deg):
        """Command both legs. Used by the pose lane."""
        return (self.servoWrite(PORT_LEFT, left_deg),
                self.servoWrite(PORT_RIGHT, right_deg))

    def last_write(self):
        return dict(self._last)

    # --------------------------------------------------------------- telemetry

    def supply_volts(self):
        """Best-effort VSYS reading in volts, or None."""
        if self._vsys is None:
            return None
        try:
            raw = self._vsys.read_u16()
            return round((raw / 65535.0) * 3.3 * 3.0, 2)
        except Exception:
            return None

    # ------------------------------------------------------------- low level

    def _write_us(self, port, us):
        rule=getattr(self,"channel_rules",{}).get(port)
        if rule:
            if not rule["enabled"]:
                self.release(port)
                return
            if getattr(self,"calibration_port",None)!=port:
                us=_clamp(us,min(rule["a_us"],rule["b_us"]),max(rule["a_us"],rule["b_us"]))
        if self.mode == "direct":
            pwm = self._pwm.get(port)
            if pwm is None:
                return
            # duty as a fraction of the 20 ms period
            pwm.duty_u16(int(us * 65535 // PERIOD_US))
        else:
            # PCA9685 counts in 4096ths of the period
            ticks = int(us * 4096 // PERIOD_US)
            self._pca_raw(port, 0, int(_clamp(ticks, 0, 4095)))

    def _pca_raw(self, port, on, off):
        if self.i2c is None:
            return
        # Kitronik numbers its sockets 1..8 -> PCA channels 0..7
        chan = int(_clamp(port - 1, 0, 15))
        base = _LED0_ON_L + 4 * chan
        try:
            self.i2c.writeto_mem(self.address, base, bytes([
                on & 0xFF, (on >> 8) & 0x0F,
                off & 0xFF, (off >> 8) & 0x0F,
            ]))
        except Exception:
            pass


# Convenience alias so `from PicoRobotics import Board` also works.
Board = KitronikPicoRobotics
