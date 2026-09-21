"""Bounded two-axis phone-gimbal control for OwlBot dog6.

The gimbal is deliberately independent from the six-servo gait. Construction
and configuration emit no PWM pulses. Only an explicit ``move`` command starts
holding pan/tilt; ``release`` returns both axes to limp.
"""

import json
import time


CAL_FILE = "gaze_cal.json"
# Owner-facing Waveshare channel numbers.  The Kitronik driver is one-based,
# so _port() performs the only +1 conversion before a PWM call.
DEFAULT_PORTS = {"gimbal_pan": 8, "gimbal_tilt": 9}
CALIBRATION_STEP_US = 4
CALIBRATION_TICK_MS = 10


def _clamp(value, low, high):
    return low if value < low else (high if value > high else value)


_AXIS_ALIASES = {
    "gimbal_tilt": "gimbal_tilt", "tilt": "gimbal_tilt",
    "head_tilt": "gimbal_tilt", "9": "gimbal_tilt",
    "ch9": "gimbal_tilt", "ch_9": "gimbal_tilt",
    "channel9": "gimbal_tilt", "channel_9": "gimbal_tilt",
    "gimbal_pan": "gimbal_pan", "pan": "gimbal_pan",
    "head_pan": "gimbal_pan", "8": "gimbal_pan",
    "ch8": "gimbal_pan", "ch_8": "gimbal_pan",
    "channel8": "gimbal_pan", "channel_8": "gimbal_pan",
}


def normalize_axis(axis):
    key = str(axis or "").strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in key:
        key = key.replace("__", "_")
    return _AXIS_ALIASES.get(key, key)


class GimbalEngine:
    def __init__(self, board):
        self.board = board
        self.pan_center_us = 1500
        self.tilt_center_us = 1500
        self.travel_us = 250
        self.pan_min_us = 1250
        self.pan_max_us = 1750
        self.tilt_min_us = 1250
        self.tilt_max_us = 1750
        self.pan_invert = False
        self.tilt_invert = False
        self.ports = dict(DEFAULT_PORTS)
        self.locks = {"gimbal_pan": False, "gimbal_tilt": False}
        self.pan = 0.0
        self.tilt = 0.0
        self.holding = False
        self.current = {"gimbal_pan": self.pan_center_us, "gimbal_tilt": self.tilt_center_us}
        self.target = dict(self.current)
        self._calibration_axis = None
        self._next_tick = 0
        self._load()
        self.current = {"gimbal_pan": self.pan_center_us, "gimbal_tilt": self.tilt_center_us}
        self.target = dict(self.current)

    def _load(self):
        try:
            with open(CAL_FILE, "r") as handle:
                saved = json.loads(handle.read())
            self._apply(saved)
        except Exception:
            pass

    def _apply(self, values):
        values = values or {}
        self.pan_center_us = int(_clamp(int(values.get(
            "pan_center_us", self.pan_center_us)), 1100, 1900))
        self.tilt_center_us = int(_clamp(int(values.get(
            "tilt_center_us", self.tilt_center_us)), 1100, 1900))
        self.travel_us = int(_clamp(int(values.get(
            "travel_us", self.travel_us)), 80, 450))
        self.pan_min_us = int(_clamp(int(values.get("pan_min_us",
            self.pan_center_us - self.travel_us)), 500, 2500))
        self.pan_max_us = int(_clamp(int(values.get("pan_max_us",
            self.pan_center_us + self.travel_us)), 500, 2500))
        self.tilt_min_us = int(_clamp(int(values.get("tilt_min_us",
            self.tilt_center_us - self.travel_us)), 500, 2500))
        self.tilt_max_us = int(_clamp(int(values.get("tilt_max_us",
            self.tilt_center_us + self.travel_us)), 500, 2500))
        if self.pan_min_us > self.pan_max_us:
            self.pan_min_us, self.pan_max_us = self.pan_max_us, self.pan_min_us
        if self.tilt_min_us > self.tilt_max_us:
            self.tilt_min_us, self.tilt_max_us = self.tilt_max_us, self.tilt_min_us
        if "pan_invert" in values:
            self.pan_invert = bool(values["pan_invert"])
        if "tilt_invert" in values:
            self.tilt_invert = bool(values["tilt_invert"])
        self._apply_ports(values.get("ports", {}))
        self.set_locks(values.get("locks", {}), save=False)

    def _apply_ports(self, values):
        if not isinstance(values, dict):
            return False
        candidate = dict(self.ports)
        try:
            for axis in ("gimbal_pan", "gimbal_tilt"):
                if axis in values:
                    port = int(values[axis])
                    if port < 0 or port > 15:
                        return False
                    candidate[axis] = port
        except Exception:
            return False
        if candidate["gimbal_pan"] == candidate["gimbal_tilt"]:
            return False
        self.ports = candidate
        return True

    def set_ports(self, values, save=True):
        if not self._apply_ports(values):
            return False
        if save:
            return self.save()
        return True

    def _port(self, axis):
        return int(self.ports[axis]) + 1

    def ports_dict(self):
        return dict(self.ports)

    def locks_dict(self):
        return {axis: bool(self.locks[axis]) for axis in self.locks}

    def set_locks(self, values, save=True):
        if not isinstance(values, dict):
            return False
        for axis in self.locks:
            if axis in values:
                self.locks[axis] = bool(values[axis])
        return self.save() if save else True

    def save(self):
        try:
            with open(CAL_FILE, "w") as handle:
                handle.write(json.dumps(self.status()))
            return True
        except Exception:
            return False

    def configure(self, values, save=True):
        """Save bounds only. This function never moves or enables a servo."""
        try:
            self._apply(values)
            return self.save() if save else True
        except Exception:
            return False

    def move(self, pan, tilt):
        try:
            pan = _clamp(float(pan), -1.0, 1.0)
            tilt = _clamp(float(tilt), -1.0, 1.0)
        except Exception:
            return False
        if self.pan_invert:
            pan = -pan
        if self.tilt_invert:
            tilt = -tilt
        pan_us = int(self.pan_center_us + pan * (
            self.pan_max_us - self.pan_center_us if pan >= 0 else self.pan_center_us - self.pan_min_us))
        tilt_us = int(self.tilt_center_us + tilt * (
            self.tilt_max_us - self.tilt_center_us if tilt >= 0 else self.tilt_center_us - self.tilt_min_us))
        self._calibration_axis = None
        self.board.servoWriteMicros(self._port("gimbal_pan"), pan_us)
        self.board.servoWriteMicros(self._port("gimbal_tilt"), tilt_us)
        self.pan = pan
        self.tilt = tilt
        self.holding = True
        return True

    def set_servo_us(self, axis, pulse_us, slow=False):
        axis = normalize_axis(axis)
        try:
            if axis == "gimbal_pan":
                low, high = self.pan_min_us, self.pan_max_us
            elif axis == "gimbal_tilt":
                low, high = self.tilt_min_us, self.tilt_max_us
            else:
                return False
            pulse = int(_clamp(int(pulse_us), low, high))
        except Exception:
            return False
        if slow:
            if self._calibration_axis != axis:
                self.board.releaseAll()
            self._calibration_axis = axis
            self.target[axis] = pulse
            self.holding = True
            return True
        self._calibration_axis = None
        self.board.releaseAll()
        if axis == "gimbal_pan":
            self.board.servoWriteMicros(self._port("gimbal_pan"), pulse)
        elif axis == "gimbal_tilt":
            self.board.servoWriteMicros(self._port("gimbal_tilt"), pulse)
        self.holding = True
        return True

    def step(self):
        """Advance an explicit calibration move slowly; ordinary gaze is direct."""
        axis = self._calibration_axis
        if not axis:
            return
        now = time.ticks_ms()
        if time.ticks_diff(now, self._next_tick) < 0:
            return
        self._next_tick = time.ticks_add(now, CALIBRATION_TICK_MS)
        cur, target = self.current[axis], self.target[axis]
        delta = target-cur
        if abs(delta) <= CALIBRATION_STEP_US:
            cur = target
        else:
            cur += CALIBRATION_STEP_US if delta > 0 else -CALIBRATION_STEP_US
        self.current[axis] = cur
        self.board.servoWriteMicros(self._port(axis), int(cur))

    def release_axis(self, axis):
        axis = normalize_axis(axis)
        if axis == "gimbal_pan":
            self.board.release(self._port("gimbal_pan"))
        elif axis == "gimbal_tilt":
            self.board.release(self._port("gimbal_tilt"))
        else:
            return False
        if self._calibration_axis == axis:
            self._calibration_axis = None
        return True

    def test_servo(self, axis, delta_us=0):
        """Move one loose gimbal servo only for channel identification."""
        axis = normalize_axis(axis)
        try:
            delta_us = int(_clamp(int(delta_us), -200, 200))
        except Exception:
            return False
        if axis == "gimbal_pan":
            sign = -1 if self.pan_invert else 1
            pulse = int(_clamp(self.pan_center_us + sign * delta_us, 650, 2350))
            self.board.servoWriteMicros(self._port("gimbal_pan"), pulse)
            self.pan = delta_us / float(max(1, self.travel_us))
        elif axis == "gimbal_tilt":
            sign = -1 if self.tilt_invert else 1
            pulse = int(_clamp(self.tilt_center_us + sign * delta_us, 650, 2350))
            self.board.servoWriteMicros(self._port("gimbal_tilt"), pulse)
            self.tilt = delta_us / float(max(1, self.travel_us))
        else:
            return False
        self.holding = True
        return True

    def release(self):
        self.board.release(self._port("gimbal_pan"))
        self.board.release(self._port("gimbal_tilt"))
        self._calibration_axis = None
        self.holding = False
        return True

    def status(self):
        return {
            "pan_center_us": self.pan_center_us,
            "tilt_center_us": self.tilt_center_us,
            "travel_us": self.travel_us,
            "pan_min_us": self.pan_min_us,
            "pan_max_us": self.pan_max_us,
            "tilt_min_us": self.tilt_min_us,
            "tilt_max_us": self.tilt_max_us,
            "pan_invert": self.pan_invert,
            "tilt_invert": self.tilt_invert,
            "pan": self.pan,
            "tilt": self.tilt,
            "holding": self.holding,
            "ports": self.ports_dict(),
            "locks": self.locks_dict(),
        }
