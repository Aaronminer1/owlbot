"""Paced head lane using authoritative saved channel limits, never body outputs."""
import time

# One commanded position per existing 50 Hz PWM period. This is a cooperative
# deadline, not an IRQ: no allocation, socket work or new PWM owner in a timer.
HEAD_TICK_MS = 20

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
        self.speed = 400
        self.run_id = 0
        self.hold_enabled = False
        self.static_hold = False
        self.retained_ports = set()
        self._reset_timing()

    def _reset_timing(self):
        # Bounded per-command counters only: no samples, strings, or logging in
        # the servo loop. Measurements describe software writes, NOT encoders
        # or oscilloscope measurements of the physical PWM/servo response.
        self.timing_started = time.ticks_ms()
        self.timing_previous = self.timing_started
        self.timing_bins = [0, 0, 0, 0, 0]  # <=10, <=25, <=40, <=100, >100 ms
        self.timing_updates = 0
        self.timing_gap_sum = 0
        self.timing_max_gap = 0
        self.timing_clamped = 0
        self.timing_max_step = 0
        self.timing_start_delay = None
        self.timing_completed = None

    def _record_timing(self, now, ramp_elapsed):
        gap = max(0, time.ticks_diff(now, self.timing_previous))
        self.timing_previous = now
        if self.timing_updates == 0:
            self.timing_start_delay = max(0, time.ticks_diff(now, self.timing_started))
        self.timing_updates += 1
        self.timing_gap_sum += gap
        self.timing_max_gap = max(self.timing_max_gap, gap)
        self.timing_clamped += max(0, ramp_elapsed - HEAD_TICK_MS)
        index = 0 if gap <= 10 else 1 if gap <= 25 else 2 if gap <= 40 else 3 if gap <= 100 else 4
        self.timing_bins[index] += 1

    def timing_status(self):
        return dict(run_id=self.run_id,updates=self.timing_updates,
            max_gap_ms=self.timing_max_gap,gap_sum_ms=self.timing_gap_sum,
            gap_bins=list(self.timing_bins),start_delay_ms=self.timing_start_delay,
            ramp_clamped_ms=self.timing_clamped,max_command_step_us=self.timing_max_step,
            completed_elapsed_ms=self.timing_completed)

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
        # A fresh move must not spend time accumulated before acceptance.
        # Preserve the output cadence during active retargets: frequent camera
        # updates must not continually postpone the next PWM write.
        if not self.motion_pending():
            self.last = time.ticks_ms()
        self.targets.update(proposed)
        self.static_hold = False
        self.run_id += 1
        self._reset_timing()
        # Owner-selected normal head rate, independent of leg speed. No timed
        # bench override: every calibrated head move uses the same paced ramp.
        self.speed = 400
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
            holding=bool(self.targets), speed_us_s=self.speed, max_speed_us_s=400,
            head_implementation='head-speed-400-cadence-v2',timing=self.timing_status(),
            update_period_ms=HEAD_TICK_MS,
            support_enabled=self.hold_enabled, static_hold=self.static_hold,
            last_commanded={a:round(v) for a,v in self.last_commanded.items()}, physical_feedback=False)

    def motion_pending(self):
        return not self.static_hold and any(self.current.get(a) != v for a,v in self.targets.items())

    def poll_delay_ms(self):
        """Maximum socket wait before the next head update is due."""
        if not self.motion_pending(): return HEAD_TICK_MS
        elapsed = max(0, time.ticks_diff(time.ticks_ms(), self.last))
        return max(0, HEAD_TICK_MS - elapsed)

    def step(self):
        now = time.ticks_ms()
        if not self.targets: return
        if self.static_hold: return  # hardware PWM continues; no repeated I/O
        if time.ticks_diff(now, self.received) > 3000:
            self.stop(); return
        if not self.motion_pending(): return  # hardware retains the final pulse
        elapsed = time.ticks_diff(now, self.last)
        if elapsed < HEAD_TICK_MS: return
        self.last = now
        config = self.config()
        measured = False
        for axis, target in self.targets.items():
            c = config[axis]
            binding = (c['channel'], c['minimum'], c['maximum'], c['center'])
            seed = self._seed(axis, c)
            old = self.current.get(axis, seed)
            if old != target and not measured:
                self._record_timing(now, elapsed)
                measured = True
            # A late network loop must not turn missed updates into a larger
            # jump or a burst of catch-up writes. At 400 us/s this is 8 us per
            # serviced period. Blocking I/O can still delay progress; timing
            # reports that delay instead of pretending it is hard real-time.
            distance = self.speed * HEAD_TICK_MS / 1000
            value = max(old-distance, min(old+distance, target))
            if old != target:
                self.timing_max_step = max(self.timing_max_step, abs(round(value)-round(old)))
            self.channels.board.servoWriteMicros(c['channel']+1, round(value))
            self.current[axis] = value
            self.last_commanded[axis] = value
            self.last_binding[axis] = binding
        if measured and all(self.current.get(axis) == target for axis,target in self.targets.items()):
            self.timing_completed = max(0, time.ticks_diff(now, self.timing_started))
