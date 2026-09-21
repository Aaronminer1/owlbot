"""Six-servo gait engine for James Bruton's small MG90S robot dog.

The phone sends only drive intent.  This module owns the 10 ms smoothing and
200 ms gait stages locally, so relay jitter cannot tear the gait apart.

Waveshare Pico Servo Driver sockets are GPIO numbers.  In ``dog6`` profile:
  socket 0/GP0 = front-left leg       socket 1/GP1 = rear-right leg
  socket 2/GP2 = front-right leg      socket 3/GP3 = rear-left leg
  socket 4/GP4 = slider               socket 5/GP5 = rotation

Pulse targets are intentionally kept in microseconds and match DogCode.ino.
No servo pulse is emitted at construction time.  The first explicit rest,
drive, calibration-test, or gesture command enables holding torque.
"""

import json
import time


TICK_MS = 10
DEFAULT_STEP_MS = 200
FILTER = 5.0
# Calibration is intentionally much slower than gait motion.  At 4 us per
# 10 ms tick, a 1000 us sweep takes roughly 2.5 seconds and remains easy to
# stop by releasing the channel.
CALIBRATION_STEP_US = 4
CAL_FILE = "dog_cal.json"
GAIT_FILE = "dog_gait.json"

ROLES = ("front_left", "rear_right", "front_right", "rear_left",
         "slider", "rotation")
LEG_ROLES = ("front_left", "rear_right", "front_right", "rear_left")
# Public channel numbers are the labels printed beside the Waveshare sockets
# (0..15).  KitronikPicoRobotics uses a one-based internal servo index, hence
# _port() below.  Keeping that conversion in one place prevents a user-set
# channel from silently being shifted by one.
DEFAULT_PORTS = {
    "front_right": 1,
    "rear_right": 2,
    "rear_left": 3,
    "front_left": 4,
    "slider": 5,
    "rotation": 6,
}
# A pulse number has no universal physical meaning. These defaults preserve the
# original assembly, but every leg can be calibrated independently after a horn
# is installed or moved.
DEFAULT_LIFT_ENDPOINTS = {
    "front_left": "min", "rear_right": "max",
    "front_right": "min", "rear_left": "max",
}
REST_US = {
    "front_left": 1800,
    "rear_right": 1200,
    "front_right": 1800,
    "rear_left": 1200,
    "slider": 1500,
    "rotation": 1500,
}
DEFAULT_OFFSETS = {
    "front_left": 0,
    "rear_right": 0,
    "front_right": 0,
    "rear_left": 0,
    "slider": 0,
    "rotation": 100,
}
# Per-role hard travel limits in microseconds. Gait frames, routines, rest,
# and calibration nudges all clamp inside these. Tighten them after assembly
# so a linkage can never bind against a mechanical end stop.
DEFAULT_LIMITS = {
    "front_left": (650, 2350),
    "rear_right": (650, 2350),
    "front_right": (650, 2350),
    "rear_left": (650, 2350),
    "slider": (650, 2350),
    "rotation": (650, 2350),
}
LIMIT_MIN, LIMIT_MAX = 500, 2500


def _clamp(value, low, high):
    return low if value < low else (high if value > high else value)


_ROLE_ALIASES = {
    "front_left": "front_left", "front_left_leg": "front_left",
    "left_front": "front_left", "left_front_leg": "front_left",
    "frontleft": "front_left", "fl": "front_left", "4": "front_left",
    "ch4": "front_left", "ch_4": "front_left",
    "channel4": "front_left", "channel_4": "front_left",
    "rear_right": "rear_right", "rear_right_leg": "rear_right",
    "back_right": "rear_right", "back_right_leg": "rear_right",
    "right_rear": "rear_right", "rr": "rear_right", "2": "rear_right",
    "ch2": "rear_right", "ch_2": "rear_right",
    "channel2": "rear_right", "channel_2": "rear_right",
    "front_right": "front_right", "front_right_leg": "front_right",
    "right_front": "front_right", "right_front_leg": "front_right",
    "frontright": "front_right", "fr": "front_right", "1": "front_right",
    "ch1": "front_right", "ch_1": "front_right",
    "channel1": "front_right", "channel_1": "front_right",
    "rear_left": "rear_left", "rear_left_leg": "rear_left",
    "back_left": "rear_left", "back_left_leg": "rear_left",
    "left_rear": "rear_left", "rl": "rear_left", "3": "rear_left",
    "ch3": "rear_left", "ch_3": "rear_left",
    "channel3": "rear_left", "channel_3": "rear_left",
    "slider": "slider", "slide": "slider", "linear": "slider",
    "5": "slider", "ch5": "slider", "ch_5": "slider",
    "channel5": "slider", "channel_5": "slider",
    "rotation": "rotation", "rotate": "rotation", "turn": "rotation",
    "6": "rotation", "ch6": "rotation", "ch_6": "rotation",
    "channel6": "rotation", "channel_6": "rotation",
}


def normalize_role(role):
    """Translate unambiguous human/channel aliases to the six wire roles."""
    key = str(role or "").strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in key:
        key = key.replace("__", "_")
    return _ROLE_ALIASES.get(key, key)


def _ticks_ms():
    fn = getattr(time, "ticks_ms", None)
    return fn() if fn else int(time.monotonic() * 1000)


def _ticks_diff(a, b):
    fn = getattr(time, "ticks_diff", None)
    return fn(a, b) if fn else a - b


def _ticks_add(a, delta):
    fn = getattr(time, "ticks_add", None)
    return fn(a, delta) if fn else a + delta


class DogEngine:
    def __init__(self, board):
        self.board = board
        self.offsets = dict(DEFAULT_OFFSETS)
        self.limits = {role: list(DEFAULT_LIMITS[role]) for role in ROLES}
        self.ports = dict(DEFAULT_PORTS)
        self.locks = {role: False for role in ROLES}
        self.lift_endpoints = dict(DEFAULT_LIFT_ENDPOINTS)
        self._load_calibration()
        self.custom_gait = []
        self._load_custom_gait()
        self.current = self._rest_frame()
        self.target = dict(self.current)
        self.mode = "idle"
        self.stage = 0
        self.step_ms = DEFAULT_STEP_MS
        self.stride = 1.0
        self._next_tick = 0
        self._stage_at = 0
        self._last_drive = 0
        self._enabled = False
        self._holding = False
        self._routine = None
        self._routine_frames = []
        self._routine_index = 0
        # Loose-servo commissioning mode: gait phases energize exactly one
        # walking channel. Disable only after the assembled body has verified
        # servo power and proves that stance joints require holding torque.
        self.single_channel = True
        self._active_role = None
        self._one_cycle = False
        self._posture_steps = []
        self._posture_index = 0

    # ----------------------------------------------------------- calibration

    def _load_calibration(self):
        try:
            with open(CAL_FILE, "r") as handle:
                saved = json.loads(handle.read())
            # Accept both the original flat file and the current structured
            # format, so an update never discards an owner's prior trims.
            saved_offsets = saved.get("offsets", saved) if isinstance(saved, dict) else {}
            for role in ROLES:
                if role in saved_offsets:
                    self.offsets[role] = int(_clamp(int(saved_offsets[role]), -350, 350))
            for role in ROLES:
                saved_lim = saved.get("limits", {}).get(role)
                if isinstance(saved_lim, dict) and "min" in saved_lim and "max" in saved_lim:
                    self._apply_limits(role, saved_lim.get("min"), saved_lim.get("max"))
            self._apply_ports(saved.get("ports", {}))
            self.set_locks(saved.get("locks", {}), save=False)
            self.set_lift_endpoints(saved.get("lift_endpoints", {}), save=False)
        except Exception:
            pass

    def _apply_limits(self, role, lo, hi):
        try:
            lo = int(_clamp(int(lo), LIMIT_MIN, LIMIT_MAX))
            hi = int(_clamp(int(hi), LIMIT_MIN, LIMIT_MAX))
        except Exception:
            return
        if lo > hi:
            lo, hi = hi, lo
        self.limits[role] = [lo, hi]

    def limits_dict(self):
        return {role: {"min": self.limits[role][0], "max": self.limits[role][1]}
                for role in ROLES}

    def ports_dict(self):
        """Return the owner-facing Waveshare channel for every body role."""
        return {role: self.ports[role] for role in ROLES}

    def locks_dict(self):
        return {role: bool(self.locks[role]) for role in ROLES}

    def lift_endpoints_dict(self):
        return {role: self.lift_endpoints[role] for role in LEG_ROLES}

    def set_lift_endpoints(self, values, save=True):
        if not isinstance(values, dict):
            return False
        for role in LEG_ROLES:
            if role not in values:
                continue
            endpoint = str(values[role]).strip().lower()
            if endpoint == "low":
                endpoint = "min"
            elif endpoint == "high":
                endpoint = "max"
            if endpoint not in ("min", "max"):
                return False
            self.lift_endpoints[role] = endpoint
        return self.save_calibration() if save else True

    def set_locks(self, values, save=True):
        if not isinstance(values, dict):
            return False
        for role in ROLES:
            if role in values:
                self.locks[role] = bool(values[role])
        return self.save_calibration() if save else True

    def _apply_ports(self, values):
        if not isinstance(values, dict):
            return False
        candidate = dict(self.ports)
        try:
            for role in ROLES:
                if role in values:
                    port = int(values[role])
                    if port < 0 or port > 15:
                        return False
                    candidate[role] = port
        except Exception:
            return False
        # Two roles on one socket is never a useful configuration and can make
        # a saved walking sequence move the wrong joint.
        if len(set(candidate.values())) != len(ROLES):
            return False
        self.ports = candidate
        return True

    def set_ports(self, values, save=True):
        if not self._apply_ports(values):
            return False
        if save:
            return self.save_calibration()
        return True

    def _port(self, role):
        return int(self.ports[role]) + 1

    def set_limits(self, values, save=True):
        if not isinstance(values, dict):
            return False
        changed = False
        for role in ROLES:
            v = values.get(role)
            if not isinstance(v, dict):
                continue
            if "min" in v or "max" in v:
                cur = self.limits[role]
                lo = int(v.get("min", cur[0]))
                hi = int(v.get("max", cur[1]))
                if lo != cur[0] or hi != cur[1]:
                    self._apply_limits(role, lo, hi)
                    changed = True
        if changed:
            if self._enabled:
                self.current = self._rest_frame()
                self.target = dict(self.current)
                self._write_current()
            if save:
                self.save_calibration()
        return True

    def save_calibration(self):
        try:
            with open(CAL_FILE, "w") as handle:
                handle.write(json.dumps({"offsets": self.offsets,
                                         "limits": self.limits_dict(),
                                         "ports": self.ports_dict(),
                                         "locks": self.locks_dict(),
                                         "lift_endpoints": self.lift_endpoints_dict()}))
            return True
        except Exception:
            return False

    def set_calibration(self, values, save=True):
        if not isinstance(values, dict):
            return False
        changed = False
        for role in ROLES:
            if role not in values:
                continue
            try:
                self.offsets[role] = int(_clamp(int(values[role]), -350, 350))
                changed = True
            except Exception:
                pass
        if changed:
            self.current = self._rest_frame()
            self.target = dict(self.current)
            if self._enabled:
                self._write_current()
            if save:
                self.save_calibration()
        return changed

    def calibration(self):
        return dict(self.offsets)

    def test_servo(self, role, delta_us=0):
        role = normalize_role(role)
        if role not in ROLES:
            return False
        # Bench calibration must never energize the other loose servos.
        self.release()
        # Large enough to identify a loose bench servo, while still far below
        # the full gait excursion. The per-role hard limits remain authoritative.
        pulse = self._pulse(role, REST_US[role] + int(_clamp(delta_us, -200, 200)))
        self.board.servoWriteMicros(self._port(role), pulse)
        self.current[role] = pulse
        self.target[role] = pulse
        return True

    def set_servo_us(self, role, pulse_us, slow=False):
        """Position one bounded channel; calibration may request a slow ramp."""
        role = normalize_role(role)
        if role not in ROLES:
            return False
        try:
            low, high = self.limits[role]
            pulse = int(_clamp(int(pulse_us), low, high))
        except Exception:
            return False
        if slow:
            # Keep only this calibration channel energized, then let step()
            # move toward the requested value in small, visible increments.
            for other in ROLES:
                if other != role:
                    self.board.release(self._port(other))
            self.mode = "calibration"
            self._active_role = role
            self.target[role] = pulse
            self._enabled = True
            self._holding = True
            return True
        # Release every other channel before a normal direct-position command.
        self.release()
        self.board.servoWriteMicros(self._port(role), pulse)
        self.current[role] = pulse
        self.target[role] = pulse
        return True

    def release_servo(self, role):
        role = normalize_role(role)
        if role not in ROLES:
            return False
        self.board.release(self._port(role))
        return True

    def _validated_gait(self, steps):
        if not isinstance(steps, list):
            return None
        clean = []
        for raw in steps[:64]:
            if not isinstance(raw, dict):
                return None
            role = normalize_role(raw.get("role"))
            if role not in ROLES:
                return None
            try:
                low, high = self.limits[role]
                pulse = int(_clamp(int(raw.get("pulse")), low, high))
                duration = int(_clamp(int(raw.get("ms", 350)), 120, 1200))
            except Exception:
                return None
            clean.append({"role": role, "pulse": pulse, "ms": duration})
        return clean if len(clean) >= 2 else None

    def _load_custom_gait(self):
        try:
            with open(GAIT_FILE, "r") as handle:
                saved = json.loads(handle.read())
            clean = self._validated_gait(saved.get("steps", saved) if isinstance(saved, dict) else saved)
            if clean:
                self.custom_gait = clean
        except Exception:
            pass

    def save_custom_gait(self, steps):
        clean = self._validated_gait(steps)
        if not clean:
            return False
        try:
            with open(GAIT_FILE, "w") as handle:
                handle.write(json.dumps({"version": 1, "steps": clean}))
            self.custom_gait = clean
            return True
        except Exception:
            return False

    def clear_custom_gait(self):
        self.custom_gait = []
        try:
            import os
            os.remove(GAIT_FILE)
        except Exception:
            pass
        return True

    def custom_gait_duration(self):
        return sum(step["ms"] for step in self.custom_gait)

    def play_custom_cycle(self):
        if not self.custom_gait:
            return 0
        self.stop(hold=False)
        self.mode = "forward"
        self.stage = 0
        self._stage_at = _ticks_ms()
        self._one_cycle = True
        self._enabled = True
        self._holding = True
        self._set_stage_target()
        return self.custom_gait_duration()

    # --------------------------------------------------------------- commands

    def drive(self, forward, yaw, step_ms=DEFAULT_STEP_MS, stride=1.0):
        try:
            forward = float(forward)
            yaw = float(yaw)
        except Exception:
            return False
        self._last_drive = _ticks_ms()
        requested_step_ms = int(_clamp(int(step_ms), 120, 450))
        self.stride = float(_clamp(float(stride), 0.35, 1.0))
        if abs(forward) < 0.08 and abs(yaw) < 0.08:
            self.stop(hold=True)
            return True
        wanted = ("forward" if forward > 0 else "backward") if abs(forward) >= abs(yaw) else (
            "right" if yaw > 0 else "left")
        if wanted != "forward" or not self.custom_gait:
            self.step_ms = requested_step_ms
        if wanted != self.mode:
            self.mode = wanted
            self.stage = 0
            self._stage_at = _ticks_ms()
            self._routine = None
            self.target = self._rest_frame()
            self._set_stage_target()
        self._enabled = True
        self._holding = True
        return True

    def play_cycle(self, forward, yaw, step_ms=DEFAULT_STEP_MS, stride=1.0):
        if not self.drive(forward, yaw, step_ms, stride):
            return 0
        if self.mode not in ("forward", "backward", "left", "right"):
            return 0
        self._one_cycle = True
        return self.custom_gait_duration() if self.mode == "forward" and self.custom_gait else self._stage_count() * self.step_ms

    def play_posture(self, name, step_ms=350):
        name = str(name or "").lower()
        if name not in ("stand", "stand_full", "lower_all"):
            return 0
        self.step_ms = int(_clamp(int(step_ms), 200, 600))
        # Full-down endpoints are the opposite of each leg's calibrated lift
        # direction. Servo orientation is an assembly fact, not a front/rear rule.
        self._posture_steps = [
            ("front_right", self._support_pulse("front_right")),
            ("rear_left", self._support_pulse("rear_left")),
            ("front_left", self._support_pulse("front_left")),
            ("rear_right", self._support_pulse("rear_right")),
        ]
        self._posture_index = 0
        self.mode = "posture"
        self._enabled = True
        self._holding = True
        self._stage_at = _ticks_ms()
        self._set_posture_target()
        return len(self._posture_steps) * self.step_ms

    def stop(self, hold=True):
        was_gait = self.mode in ("forward", "backward", "left", "right", "posture")
        if self.single_channel and was_gait:
            hold = False
        self.mode = "idle"
        self.stage = 0
        self._routine = None
        self._routine_frames = []
        self._one_cycle = False
        self._posture_steps = []
        self._posture_index = 0
        self.target = self._rest_frame()
        self._enabled = bool(hold)
        self._holding = bool(hold)
        if hold:
            self._write_current()
        else:
            self.release()

    def release(self):
        for role in ROLES:
            try:
                self.board.release(self._port(role))
            except Exception:
                pass
        self._enabled = False
        self._holding = False
        self.mode = "released"
        self._active_role = None

    def play_routine(self, name):
        name = str(name or "center").lower()
        rest = dict(REST_US)
        gentle = 110
        routines = {
            "center": [(rest, 450)],
            "stand": [(rest, 450)],
            "sit": [(rest, 450)],
            "lay": [(rest, 450)],
            "hop": [(rest, 450)],
            "wiggle": [({"rotation": 1500-gentle}, 220),
                       ({"rotation": 1500+gentle}, 220), (rest, 260)],
            "nod": [({"slider": 1420}, 240), ({"slider": 1580}, 240),
                    (rest, 260)],
            "shiver": [({"rotation": 1450}, 90), ({"rotation": 1550}, 90),
                       ({"rotation": 1450}, 90), ({"rotation": 1550}, 90),
                       (rest, 220)],
            "stretch": [({"slider": 1370}, 360), ({"slider": 1630}, 360),
                        (rest, 300)],
        }
        frames = routines.get(name)
        if not frames:
            return 0
        self.mode = "routine"
        self._routine = name
        self._routine_frames = frames
        self._routine_index = 0
        self._enabled = True
        self._holding = True
        self._set_routine_target()
        return sum(frame[1] for frame in frames)

    # ------------------------------------------------------------------ tick

    def step(self):
        now = _ticks_ms()
        if _ticks_diff(now, self._next_tick) < 0:
            return
        self._next_tick = _ticks_add(now, TICK_MS)
        if not self._enabled:
            return

        if self.single_channel and self.mode in ("forward", "backward", "left", "right", "posture", "calibration"):
            role = self._active_role
            if role:
                cur = self.current[role]
                target = self.target[role]
                if self.mode == "calibration":
                    delta = target-cur
                    self.current[role] = target if abs(delta) <= CALIBRATION_STEP_US else cur + (
                        CALIBRATION_STEP_US if delta > 0 else -CALIBRATION_STEP_US)
                else:
                    self.current[role] = target if abs(target-cur) < 1.0 else (
                        target + cur * FILTER) / (FILTER + 1.0)
                self.board.servoWriteMicros(self._port(role), int(self.current[role]))
        else:
            for role in ROLES:
                cur = self.current[role]
                target = self.target[role]
                if abs(target - cur) < 1.0:
                    self.current[role] = target
                else:
                    self.current[role] = (target + cur * FILTER) / (FILTER + 1.0)
            self._write_current()

        if self.mode == "routine":
            if _ticks_diff(now, self._stage_at) >= self._routine_frames[self._routine_index][1]:
                self._routine_index += 1
                if self._routine_index >= len(self._routine_frames):
                    self.stop(hold=True)
                else:
                    self._set_routine_target()
            return

        if self.mode == "posture":
            if _ticks_diff(now, self._stage_at) >= self.step_ms:
                self._posture_index += 1
                if self._posture_index >= len(self._posture_steps):
                    self.stop(hold=False)
                else:
                    self._stage_at = now
                    self._set_posture_target()
            return

        if self.mode in ("forward", "backward", "left", "right"):
            if _ticks_diff(now, self._stage_at) >= self.step_ms:
                next_stage = self.stage + 1
                if self._one_cycle and next_stage >= self._stage_count():
                    self.stop(hold=False)
                    return
                self.stage = next_stage % self._stage_count()
                self._stage_at = now
                self._set_stage_target()

    # --------------------------------------------------------------- helpers

    def _pulse(self, role, base_us):
        lo, hi = self.limits[role]
        return int(_clamp(int(base_us) + self.offsets[role], lo, hi))

    def _rest_frame(self):
        return {role: self._pulse(role, REST_US[role]) for role in ROLES}

    def _scaled(self, role, extreme):
        rest = REST_US[role]
        return rest + (extreme - rest) * self.stride

    def _lift_scaled(self, role):
        endpoint = self.limits[role][0 if self.lift_endpoints[role] == "min" else 1]
        return self._scaled(role, endpoint - self.offsets[role])

    def _support_pulse(self, role):
        endpoint = self.limits[role][1 if self.lift_endpoints[role] == "min" else 0]
        return int(endpoint)

    def _frame(self, changes=None):
        base = dict(REST_US)
        if changes:
            base.update(changes)
        return {role: self._pulse(role, base[role]) for role in ROLES}

    def _stage_count(self):
        if self.mode == "forward" and self.custom_gait:
            return len(self.custom_gait)
        return 11 if self.mode in ("forward", "backward") else 10

    def _set_posture_target(self):
        role, pulse = self._posture_steps[self._posture_index]
        self._active_role = role
        for other in ROLES:
            if other != role:
                self.board.release(self._port(other))
        self.target[role] = int(pulse)

    def _set_stage_target(self):
        s = self.stage
        if self.mode == "forward" and self.custom_gait:
            step = self.custom_gait[s % len(self.custom_gait)]
            self._active_role = step["role"]
            self.step_ms = step["ms"]
            for other in ROLES:
                if other != self._active_role:
                    self.board.release(self._port(other))
            self.target[self._active_role] = int(_clamp(step["pulse"],
                self.limits[self._active_role][0], self.limits[self._active_role][1]))
            return
        if self.mode == "forward":
            slide_min, slide_max = self.limits["slider"]
            frames = (
                # One moving servo per phase. The first slider phase establishes
                # the starting end on the first cycle and is already satisfied
                # when subsequent cycles wrap around.
                {"slider": self._scaled("slider", slide_min - self.offsets["slider"])},
                {"front_right": self._lift_scaled("front_right")},
                {"rear_left": self._lift_scaled("rear_left")},
                {"slider": self._scaled("slider", slide_max - self.offsets["slider"])},
                {"front_right": REST_US["front_right"]},
                {"rear_left": REST_US["rear_left"]},
                {"front_left": self._lift_scaled("front_left")},
                {"rear_right": self._lift_scaled("rear_right")},
                {"slider": self._scaled("slider", slide_min - self.offsets["slider"])},
                {"front_left": REST_US["front_left"]},
                {"rear_right": REST_US["rear_right"]},
            )
        elif self.mode == "backward":
            slide_min, slide_max = self.limits["slider"]
            frames = (
                {"slider": self._scaled("slider", slide_max - self.offsets["slider"])},
                {"front_right": self._lift_scaled("front_right")},
                {"rear_left": self._lift_scaled("rear_left")},
                {"slider": self._scaled("slider", slide_min - self.offsets["slider"])},
                {"front_right": REST_US["front_right"]},
                {"rear_left": REST_US["rear_left"]},
                {"front_left": self._lift_scaled("front_left")},
                {"rear_right": self._lift_scaled("rear_right")},
                {"slider": self._scaled("slider", slide_max - self.offsets["slider"])},
                {"front_left": REST_US["front_left"]},
                {"rear_right": REST_US["rear_right"]},
            )
        elif self.mode == "left":
            frames = (
                {"front_left": self._lift_scaled("front_left")},
                {"rear_right": self._lift_scaled("rear_right")},
                {"rotation": self._scaled("rotation", self.limits["rotation"][0] - self.offsets["rotation"])},
                {"front_left": REST_US["front_left"]},
                {"rear_right": REST_US["rear_right"]},
                {"front_right": self._lift_scaled("front_right")},
                {"rear_left": self._lift_scaled("rear_left")},
                {"rotation": REST_US["rotation"]},
                {"front_right": REST_US["front_right"]},
                {"rear_left": REST_US["rear_left"]},
            )
        else:  # right: same rotation stroke, opposite diagonal order
            frames = (
                {"front_right": self._lift_scaled("front_right")},
                {"rear_left": self._lift_scaled("rear_left")},
                {"rotation": self._scaled("rotation", self.limits["rotation"][1] - self.offsets["rotation"])},
                {"front_right": REST_US["front_right"]},
                {"rear_left": REST_US["rear_left"]},
                {"front_left": self._lift_scaled("front_left")},
                {"rear_right": self._lift_scaled("rear_right")},
                {"rotation": REST_US["rotation"]},
                {"front_left": REST_US["front_left"]},
                {"rear_right": REST_US["rear_right"]},
            )
        target = dict(self.target)
        for role, base_us in frames[s].items():
            target[role] = self._pulse(role, base_us)
            self._active_role = role
        if self.single_channel:
            for other in ROLES:
                if other != self._active_role:
                    self.board.release(self._port(other))
        self.target = target

    def _set_routine_target(self):
        changes, _duration = self._routine_frames[self._routine_index]
        self.target = self._frame(changes)
        self._stage_at = _ticks_ms()

    def _write_current(self):
        for role in ROLES:
            self.board.servoWriteMicros(self._port(role), int(self.current[role]))

    def status(self):
        return {"mode": self.mode, "stage": self.stage,
                "holding": self._holding, "cal": self.calibration(),
                "limits": self.limits_dict(), "ports": self.ports_dict(), "locks": self.locks_dict(),
                "lift_endpoints": self.lift_endpoints_dict(), "single_channel": self.single_channel,
                "active_role": self._active_role,
                "custom_gait_steps": len(self.custom_gait),
                "custom_gait": self.custom_gait}
