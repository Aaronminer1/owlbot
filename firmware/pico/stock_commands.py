"""Exact saved-gesture commands carried by GrowBot's existing act packet.

These are an explicit encoding agreement, NOT a classifier for arbitrary leg
poses or neural policies. All eight frames (including durations and checksum)
must match. Decode before interpolation; malformed marked packets never reach
the legs. L==R makes the encoding invariant to the browser's leg-swap setting.
The channel calibration remains authoritative. No output or movement on import.
"""
import time

NAMES = ('turn left', 'turn right', 'look left', 'look right',
         'look up', 'look down', 'look ahead')
# Preserve 15% for existing profiles; this body's commissioned profile can opt
# into up to 60%. This is linkage travel, NOT degrees of body heading.
PAN_EXTENT = 0.60
TILT_EXTENT = 0.60

# Explicit names carried by the existing routine packet. Stock neural-policy
# pose streams do NOT carry these names and must never be classified by this
# table. One named spin is one bounded calibrated turn, not a timed full spin.
TURN_ALIASES = {'spin left': 1, 'spin_left': 1, 'turn left': 1, 'turn_left': 1,
                'spin right': 2, 'spin_right': 2, 'turn right': 2, 'turn_right': 2}


def named_opcode(name):
    if not isinstance(name, str):
        return None
    return TURN_ALIASES.get(name)


def frames(op):
    if type(op) is not int or not 1 <= op <= len(NAMES):
        raise ValueError('unknown_saved_body_command')
    values = (87, 93, 88, 90 + op, 107 - op, 92, 86, 90)
    # 60% pan can travel 1200 us across both sides: 8 s at 150 us/s.
    # Use the browser's existing eight-frame/2000-ms-per-frame contract to
    # reserve 10.286 s for pan, without modifying website code or speeding up.
    durations = ((137, 149, 1500, 1500, 1500, 1500, 2000, 2000) if op in (3, 4)
                 else (137, 149, 163, 181, 193, 197, 2000, 2000))
    return [dict(l=v, r=v, ms=ms) for v, ms in zip(values, durations)]


def decode(steps):
    if not isinstance(steps, list) or not steps:
        return None
    # Reserve the tag even if a later frame is truncated/corrupted. Ordinary
    # factory gestures do not use this tag. This is framing, not authentication.
    # Redundant first/second tags catch a damaged field or a dropped first frame.
    # Arbitrary corruption of ALL framing is not distinguishable from a normal
    # gesture; this protocol is not a generic corruption/authentication layer.
    def tag(s, value, duration):
        return isinstance(s, dict) and sum((s.get('l') == value,
            s.get('r') == value, s.get('ms') == duration)) >= 2
    if not any(tag(s, 87, 137) or tag(s, 93, 149) for s in steps[:2]):
        return None
    for op in range(1, len(NAMES) + 1):
        expected = frames(op)
        if len(steps) == 8 and all(
                isinstance(s, dict) and set(s) == {'l', 'r', 'ms'} and
                all(type(s[k]) is int and s[k] == e[k] for k in e)
                for s, e in zip(steps, expected)):
            return op
    raise ValueError('corrupt_saved_body_command')


class StockCommands:
    decode = staticmethod(decode)
    named_opcode = staticmethod(named_opcode)

    def __init__(self, channels, walk, turn, head, shared, config=None):
        self.channels, self.walk, self.turn = channels, walk, turn
        self.head, self.shared = head, shared
        self.config = config if isinstance(config, dict) else {}
        self.active = None
        self.last = None
        self.error = None
        self.run_id = 0
        self.started = 0
        self.turn_run = None
        self.completed = False
        self.return_closed = False
        self.window_ms = 4800

    def turn_fraction(self):
        value = self.config.get('turn_fraction', 0.15)
        return value if type(value) in (int, float) and 0.02 <= value <= 0.60 else None

    def start(self, op, mode='replace'):
        if self.config.get('enabled') is not True:
            raise ValueError('saved_body_commands_not_enabled')
        if mode != 'replace':
            raise ValueError('saved_body_commands_cannot_append')
        if type(op) is not int or not 1 <= op <= len(NAMES):
            raise ValueError('unknown_saved_body_command')
        if self.active or self.walk.running or self.turn.running:
            raise ValueError('stop_active_motion_before_saved_command')
        if self.channels.active is not None or self.channels.queue:
            raise ValueError('finish_manual_motion_before_saved_command')
        if op <= 2:
            fraction = self.turn_fraction()
            if fraction is None:
                raise ValueError('saved_turn_fraction_must_be_0.02_to_0.60')
            # Direction must come from this assembled body's recorded mapping,
            # not inference from two virtual leg angles or a servo port number.
            m = self.shared.resolve(dict(body_version=1, body_action='turn',
                direction='left' if op == 1 else 'right',
                pattern_a_direction=self.config.get('pattern_a_direction'),
                fraction=fraction))
            plan = dict(self.walk.plan or {})
            plan['speed_us_s'] = min(800, plan.get('speed_us_s', 150))
            plan['lift_percent'] = min(50, plan.get('lift_percent', 50))
            state = self.turn.start_turn(plan, m['turn_channel'], m['binding'],
                                         m['pattern'], m['fraction'])
            self.head.support()
            self.turn_run = state['run_id']
            self.turn_channel = m['turn_channel']
            c = self.channels.channels[self.turn_channel]
            self.closed = c['a_us'] if c['a_name'].lower() == 'closed' else c['b_us']
        else:
            pairs = {3: [('pan', -PAN_EXTENT)], 4: [('pan', PAN_EXTENT)],
                     5: [('tilt', TILT_EXTENT)], 6: [('tilt', -TILT_EXTENT)],
                     7: [('pan', 0), ('tilt', 0)]}[op]
            # This mounted body's observed pan direction can differ from its
            # saved endpoint labels. Correct only GrowBot's gesture semantics;
            # do not rewrite calibration or invert OwlBot/shared head commands.
            if self.config.get('pan_inverted') is True:
                pairs = [(a, -v if a == 'pan' else v) for a, v in pairs]
            # Resolve/validate both center axes before issuing either command.
            requests = [self.shared.resolve(dict(body_version=1,
                body_action='head', axis=a, position=v)) for a, v in pairs]
            used = {s['channel'] for s in (self.walk.plan or {}).get('steps', [])}
            used.update(c['channel'] for c in self.channels.channels if
                        c['enabled'] and c['name'].lower() in ('turn', 'body turn', 'rotation'))
            for m in requests:
                self.head.move(m, used)
        self.active = NAMES[op - 1]
        self.last = self.active
        self.error = None
        self.completed = False
        self.return_closed = False
        self.run_id += 1
        self.started = time.ticks_ms()
        self.window_ms = 10000 if op in (3, 4) else 4800
        return self.status()

    def cancel(self):
        active, self.active = self.active, None
        if active and active.startswith('turn'):
            self.turn.cancel()
        elif active:
            self.head.stop()

    def step(self):
        if not self.active:
            return
        age = time.ticks_diff(time.ticks_ms(), self.started)
        if age >= self.window_ms:
            if self.active.startswith('turn') and self.turn.running:
                self.error = 'saved_turn_execution_timeout'
            elif not self.active.startswith('turn'):
                self.completed = all(self.head.current.get(a) == p for a, p in self.head.targets.items()) and bool(self.head.targets)
                if not self.completed:
                    self.error = 'saved_head_execution_interrupted'
            self.cancel()
            return
        if self.active.startswith('turn'):
            if not self.turn.running:
                self.error = self.turn.error
                self.return_closed = self.channels.current.get(self.turn_channel) == self.closed
                if not self.return_closed and not self.error:
                    self.error = 'saved_turn_did_not_return_closed'
                self.completed = self.return_closed and self.error is None
                self.active = None
                # Return Closed is commanded by NamedTurn before this release.
                self.channels.stop()
            elif self.turn.run_id != self.turn_run:
                self.active = None
                self.error = 'saved_turn_preempted'
            else:
                # A single atomic gesture authorizes ONLY this bounded turn.
                # Not an unbounded stream lease. Stop/disconnect cancel it.
                self.turn.keepalive(self.turn_run)
        else:
            # Renew motion during the command; configured support freezes the
            # head at completion instead of releasing the load-bearing servos.
            self.head.received = time.ticks_ms()

    def status(self):
        return dict(protocol=2, enabled=self.config.get('enabled') is True,
                    named_turn_aliases=sorted(TURN_ALIASES),
                    alias_transport='routine.name', pose_stream_turn_inference=False,
                    head_support_enabled=self.head.hold_enabled,
                    pan_inverted=self.config.get('pan_inverted') is True,
                    active=self.active, last=self.last, error=self.error,
                    completed=self.completed, return_closed_commanded=self.return_closed,
                    run_id=self.run_id, head_max_speed_us_s=150,
                    turn_fraction=self.turn_fraction(), pan_extent=PAN_EXTENT,
                    tilt_extent=TILT_EXTENT, command_window_ms=self.window_ms,
                    physical_feedback=False)
