"""One bounded front-leg/head bow, using the existing PWM owners.

Up is a FOOT-lift endpoint: moving both front legs a little toward Up shortens
their support and lowers the front of this body. Down is standing support.
There are no encoders; all completion fields describe commanded positions.
No file writes, network calls, sleeping, or output at import/construction.
"""
import time

# Fraction of each calibrated travel interval, not an absolute servo angle.
# Owner requested a deeper bow after confirming the initial shallow bow worked.
FRONT_FRACTION = 0.40
HEAD_FRACTION = 0.45
LEG_SPEED = 250
HOLD_MS = 400
WINDOW_MS = 8000


class BodyBow:
    def __init__(self, channels, head, walk):
        self.channels, self.head, self.walk = channels, head, walk
        self.phase = 'idle'
        self.running = False
        self.completed = False
        self.error = None
        self.front = []
        self.support = []
        self.head_run = None

    def start(self):
        # Validate the whole plan BEFORE taking ownership or writing PWM.
        if self.channels.active is not None or self.channels.queue:
            raise ValueError('finish_manual_motion_before_bow')
        if not self.head.hold_enabled or self.head.motion_pending():
            raise ValueError('bow_needs_supported_idle_head')
        self.walk.validate(self.walk.plan)
        names = ('left rear leg', 'right rear leg', 'left front leg', 'right front leg')
        used = set(s['channel'] for s in self.walk.plan['steps'])
        legs = []
        for name in names:
            found = [c for c in self.channels.channels if c['enabled'] and c['name'].lower() == name]
            if len(found) != 1:
                raise ValueError('bow_needs_four_unambiguous_named_legs')
            c = found[0]
            ends = {c['a_name'].lower():c['a_us'], c['b_name'].lower():c['b_us']}
            if not c['calibrated'] or set(ends) != set(('up','down')) or c['channel'] not in used:
                raise ValueError('bow_leg_binding_invalid')
            legs.append(dict(channel=c['channel'], down=ends['down'],
                bent=round(ends['down']+(ends['up']-ends['down'])*FRONT_FRACTION)))
        cfg = self.head.config()
        if any(c['channel'] in used for c in cfg.values()):
            raise ValueError('bow_head_overlaps_body')
        tilt = self.channels.channels[cfg['tilt']['channel']]
        ends = {tilt['a_name'].lower():tilt['a_us'], tilt['b_name'].lower():tilt['b_us']}
        if set(ends) != set(('up','down')):
            raise ValueError('bow_needs_semantic_tilt_endpoints')
        # Return to the initial commanded tilt, not an unrelated neutral pose.
        origin = round(self.head.current.get('tilt', self.head._seed('tilt',cfg['tilt'])))
        if not cfg['tilt']['minimum'] <= origin <= cfg['tilt']['maximum']:
            raise ValueError('bow_invalid_head_origin')
        lowered = round(origin+(ends['down']-origin)*HEAD_FRACTION)
        if abs(lowered-origin) < 8:
            raise ValueError('head_already_down_before_bow')
        self.front, self.support = legs[2:], list(legs)
        self.used, self.origin, self.lowered = used, origin, lowered
        self.phase = 'support'
        self.running, self.completed, self.error = True, False, None
        self.started = time.ticks_ms()
        self.head_run = None
        self.head.support()
        self._next_support()

    def _next_support(self):
        if self.support:
            leg = self.support.pop(0)
            # Same commissioned Down engagement as the corrected walking start:
            # no invented midpoint lifts an unknown but already planted foot.
            self.channels.move([dict(channel=leg['channel'],position='Down')],
                               speed=LEG_SPEED,walk_support=True)
        else:
            self._together('lower')

    def _together(self, phase):
        key = 'bent' if phase == 'lower' else 'down'
        pulse = self.lowered if phase == 'lower' else self.origin
        targets = [dict(channel=c['channel'],pulse_us=c[key]) for c in self.front]
        distance = max(abs(c[key]-self.channels.current[c['channel']]) for c in self.front)
        seconds = max(0.4, distance/LEG_SPEED)
        # Both lanes receive targets in one scheduler call, not two phone trips.
        # Each still uses its established paced output owner and saved limits.
        self.channels.move(targets,speed=LEG_SPEED,parallel=True)
        self.head.move(dict(axis='tilt',pulse=pulse),self.used)
        # A bow is intentionally gentler than the owner's 400 us/s head ceiling.
        # Match approximate leg duration without changing the normal head rate.
        self.head.speed = min(400,max(20,abs(pulse-self.head.current.get('tilt',self.origin))/seconds))
        self.head_run = self.head.run_id
        self.phase = phase

    def cancel(self, error='bow_cancelled'):
        was_running = self.running
        self.running = False
        if was_running:
            self.error = error
            self.phase = 'cancelled'
            # Freeze the current commanded pose. Never spring upright after a
            # Stop or disconnection; retain head support, then caller's existing
            # Stop/release policy can release the body if explicitly requested.
            self.channels.queue = []
            self.channels.active = None
            self.channels.last_tick = None
            self.head.stop()
        self.head.speed = 400

    def step(self):
        if not self.running:
            return
        try:
            now = time.ticks_ms()
            if time.ticks_diff(now,self.started) >= WINDOW_MS:
                raise ValueError('bow_execution_timeout')
            if not self.channels.owning or not self.head.targets:
                raise ValueError('bow_output_ownership_lost')
            self.head.received = now
            if self.head_run is not None and self.head.run_id != self.head_run:
                raise ValueError('bow_head_preempted')
            busy = self.channels.active is not None or bool(self.channels.queue)
            if self.phase == 'support' and not busy:
                self._next_support()
            elif self.phase in ('lower','rise') and not busy and not self.head.motion_pending():
                key = 'bent' if self.phase == 'lower' else 'down'
                pulse = self.lowered if self.phase == 'lower' else self.origin
                if (any(self.channels.current.get(c['channel']) != c[key] for c in self.front)
                        or self.head.current.get('tilt') != pulse):
                    raise ValueError('bow_commanded_target_not_reached')
                if self.phase == 'lower':
                    self.phase, self.held_at = 'hold', now
                else:
                    self.phase = 'completed'
                    self.running, self.completed = False, True
                    self.head.speed = 400
            elif self.phase == 'hold' and time.ticks_diff(now,self.held_at) >= HOLD_MS:
                self._together('rise')
        except Exception as error:
            self.cancel(str(error))

    def status(self):
        return dict(implementation='front-head-bow-v1',phase=self.phase,
            running=self.running,completed=self.completed,error=self.error,
            front_fraction=FRONT_FRACTION,head_fraction=HEAD_FRACTION,
            leg_speed_us_s=LEG_SPEED,physical_feedback=False)
