"""Paced head lane using authoritative saved channel limits, never body outputs."""
import time

class PicoHead:
    def __init__(self, channels, ports):
        self.channels = channels
        self.ports = ports
        self.current = {}
        # PWM release is not a move to center. Remember our last output so the
        # next command (especially center) ramps from it instead of snapping.
        # This is volatile commanded state, never encoder/physical feedback.
        self.last_commanded = {}
        self.last_binding = {}
        self.targets = {}
        self.last = time.ticks_ms()
        self.received = self.last
        self.speed = 150
        self.run_id = 0
        self.hold_enabled = False
        self.static_hold = False
        self.retained_ports = set()

    def _seed(self, axis, c):
        binding = (c['channel'], c['minimum'], c['maximum'], c['center'])
        return self.last_commanded.get(axis, c['center']) if self.last_binding.get(axis) == binding else c['center']

    def support(self):
        """Engage both head axes on a body command, never merely at boot/info."""
        if self.hold_enabled and not self.targets:
            c = self.config()['pan']
            self.move(dict(axis='pan', pulse=round(self._seed('pan', c))),
                      set(self.channels.dog.ports_dict().values()))

    def config(self):
        ports = self.ports()
        result = {}
        for axis in ('pan', 'tilt'):
            ch = ports['gimbal_' + axis]
            c = self.channels.channels[ch]
            if not c['enabled'] or not c['calibrated']:
                raise ValueError('head_channel_not_calibrated')
            result[axis] = dict(channel=ch, minimum=min(c['a_us'], c['b_us']),
                maximum=max(c['a_us'], c['b_us']), center=c['center_us'])
        if result['pan']['channel'] == result['tilt']['channel']:
            raise ValueError('head_channels_overlap')
        return result

    def move(self, message, body_channels):
        config = self.config()
        if any(c['channel'] in body_channels for c in config.values()):
            raise ValueError('head_channel_overlaps_body')
        proposed = {}
        for axis, c in config.items():
            if message.get('axis') == axis:
                pulse = message.get('pulse')
                if type(pulse) is not int: raise ValueError('integer_head_pulse_required')
            elif message.get('axis') is None and axis in message:
                value = message[axis]
                if type(value) not in (int, float) or not -1 <= value <= 1:
                    raise ValueError('invalid_head_position')
                pulse = round(c['center'] + value * (c['maximum'] - c['center'] if value >= 0 else c['center'] - c['minimum']))
            else: continue
            if not c['minimum'] <= pulse <= c['maximum']: raise ValueError('outside_saved_head_limits')
            proposed[axis] = pulse
        if not proposed: raise ValueError('head_target_required')
        if self.hold_enabled:
            # Pan alone must not leave the load-bearing tilt unsupported.
            for axis, c in config.items():
                if axis not in proposed and axis not in self.targets:
                    proposed[axis] = round(self._seed(axis, c))
            if not hasattr(self.channels.board, 'retained_servo_ports'):
                self.channels.board.retained_servo_ports = set()
            for axis in proposed:
                port = config[axis]['channel'] + 1
                self.retained_ports.add(port)
                self.channels.board.retained_servo_ports.add(port)
        self.targets.update(proposed)
        self.static_hold = False
        self.run_id += 1
        # Mechanical phone-holder limit, not an optional caller preference.
        self.speed = 150
        self.received = time.ticks_ms()
        return self.status()

    def release_axis(self, axis):
        if axis not in ('pan', 'tilt'):
            return
        port = self.ports()['gimbal_' + axis] + 1
        getattr(self.channels.board, 'retained_servo_ports', set()).discard(port)
        self.retained_ports.discard(port)
        self.targets.pop(axis, None)
        self.current.pop(axis, None)
        self.channels.board.release(port)

    def stop(self, force=False):
        if self.hold_enabled and not force:
            # Cancel motion, NOT support: freeze at the last actual PWM command,
            # never leap to an unfinished target or resume it on a later tick.
            self.targets = dict(self.current)
            self.static_hold = bool(self.targets)
            return
        protected = getattr(self.channels.board, 'retained_servo_ports', set())
        for port in self.retained_ports:
            protected.discard(port)
            self.channels.board.release(port)
        self.retained_ports = set()
        for axis in self.targets:
            self.channels.board.release(self.ports()['gimbal_' + axis] + 1)
        self.targets = {}
        self.current = {}
        self.static_hold = False
        # Keep last_commanded while reporting no active outputs/holding.

    def status(self):
        self.received = time.ticks_ms()
        return dict(config=self.config(), targets=dict(self.targets),run_id=self.run_id,commanded={a:round(v) for a,v in self.current.items()},
            moving=any(self.current.get(a) != v for a,v in self.targets.items()),
            holding=bool(self.targets), speed_us_s=self.speed, max_speed_us_s=150,
            support_enabled=self.hold_enabled, static_hold=self.static_hold,
            last_commanded={a:round(v) for a,v in self.last_commanded.items()}, physical_feedback=False)

    def step(self):
        now = time.ticks_ms()
        elapsed = time.ticks_diff(now, self.last)
        self.last = now
        if not self.targets: return
        if self.static_hold: return  # hardware PWM continues; no repeated I/O
        if time.ticks_diff(now, self.received) > 3000:
            self.stop(); return
        config = self.config()
        for axis, target in self.targets.items():
            c = config[axis]
            binding = (c['channel'], c['minimum'], c['maximum'], c['center'])
            seed = self._seed(axis, c)
            old = self.current.get(axis, seed)
            distance = self.speed * max(0, min(40, elapsed)) / 1000
            value = max(old-distance, min(old+distance, target))
            self.channels.board.servoWriteMicros(c['channel']+1, round(value))
            self.current[axis] = value
            self.last_commanded[axis] = value
            self.last_binding[axis] = binding
