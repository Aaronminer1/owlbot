"""Persisted, channel-based forward walk. No PWM on load/save.

Taught diagonal feet can move together; slide waits for both feet.
Progress is commanded position, never encoder or physical arrival feedback.
"""
import json
import os
import time


class NamedGait:
    def __init__(self, channels, filename="named_walk.json"):
        self.channels = channels
        self.filename = filename
        self.plan = None
        self.error = None
        self.running = False
        self.index = 0
        self.pending = []
        self.wait_until = None
        self.started = 0
        self.run_id = 0
        self.waiting_for_vision = False
        self.direction = "forward"
        self.bench = False
        self.run_cycles = 1
        self.run_speed = None
        self.continuous = False
        self.cycle_offset = 0
        self.step_offset = 0
        self.phase_size = 1
        self.preview_cycle = -1
        self.preview_deadline = 0
        try:
            with open(filename) as f:
                self.plan = json.load(f)
            self.validate(self.plan)
        except OSError as e:
            if not e.args or e.args[0] != 2:
                self.error = "saved_walk_unreadable"
        except Exception as e:
            self.error = str(e)

    def validate(self, plan):
        if not isinstance(plan, dict) or plan.get("version") != 1:
            raise ValueError("unsupported_named_walk")
        steps = plan.get("steps")
        if not isinstance(steps, list) or not 2 <= len(steps) <= 64:
            raise ValueError("walk_needs_2_to_64_steps")
        speed = plan.get("speed_us_s", 150)
        if type(speed) is not int or not 20 <= speed <= 1600:
            raise ValueError("walk_speed_must_be_20_to_1600")
        if type(plan.get('paired_feet', True)) is not bool:
            raise ValueError('paired_feet_must_be_boolean')
        settle=plan.get('settle_ms',20)
        if type(settle) is not int or not 0 <= settle <= 500:
            raise ValueError('settle_ms_must_be_0_to_500')
        cycles = plan.get("cycles", 1)
        if type(cycles) is not int or not 1 <= cycles <= 10:
            raise ValueError("walk_cycles_must_be_1_to_10")
        lift = plan.get("lift_percent", 50)
        if type(lift) is not int or not 10 <= lift <= 100:
            raise ValueError("walk_lift_must_be_10_to_100")
        for step in steps:
            ch = step.get("channel")
            if isinstance(ch, bool) or not isinstance(ch, int) or not 0 <= ch <= 15:
                raise ValueError("invalid_walk_channel")
            c = self.channels.channels[ch]
            if not c["enabled"] or not c["calibrated"]:
                raise ValueError("walk_channel_%d_needs_calibration" % ch)
            # Renaming/remapping/recalibrating requires an explicit re-save.
            keys = ("name", "a_name", "b_name", "a_us", "b_us", "center_us")
            if step.get("binding") != {k: c[k] for k in keys}:
                raise ValueError("walk_channel_%d_changed_resave_walk" % ch)
            if step.get("position") not in (c["a_name"], c["b_name"]):
                raise ValueError("unknown_walk_position")
        return plan

    def save(self, plan):
        if self.running or self.channels.active is not None or self.channels.queue:
            raise ValueError("stop_movement_before_saving_walk")
        self.validate(plan)
        # Store only the public, validated schema.
        clean = dict(version=1, name="Forward Walk",
                     speed_us_s=int(plan.get("speed_us_s", 150)),
                     cycles=plan.get("cycles", 1),
                     lift_percent=plan.get("lift_percent", 50),
                     paired_feet=plan.get('paired_feet',True),
                     settle_ms=plan.get('settle_ms',20),
                     steps=[dict(channel=s["channel"], position=s["position"],
                                 binding=dict(s["binding"])) for s in plan["steps"]])
        tmp = self.filename + ".tmp"
        with open(tmp, "w") as f:
            json.dump(clean, f)
        getattr(os, "replace", os.rename)(tmp, self.filename)
        self.plan = clean
        self.error = None
        return clean

    def start(self, direction="forward", path_clear=False, bench=False, continuous=False, pace=None, cycles=None):
        speeds = {'creep':200, 'slow':600, 'fast':1000, 'run':1600}
        if pace is not None and (type(pace) is not str or pace not in speeds):
            raise ValueError('unknown_walk_pace')
        if self.running:
            return self.status()
        if direction not in ("forward", "backward"):
            raise ValueError("unknown_walk_direction")
        if continuous is not True and continuous is not False:
            raise ValueError('invalid_continuous_mode')
        if continuous is True and cycles not in (None, 1):
            raise ValueError('continuous_uses_internal_cycles')
        if cycles is not None and (type(cycles) is not int or not 1 <= cycles <= 10):
            raise ValueError('invalid_walk_cycles')
        if bench is True and cycles not in (None, 1):
            raise ValueError('manual_test_requires_one_cycle')
        if bench is not True and path_clear is not True:
            raise ValueError("fresh_directional_vision_required")
        self.validate(self.plan)
        if self.channels.active is not None or self.channels.queue:
            raise ValueError("another_servo_move_is_active")
        self.run_speed = speeds[pace] if pace is not None else self.plan.get('speed_us_s',150)
        # Recognize only the taught diagonal walk, independently of whether
        # paired output is enabled. NamedTurn and arbitrary plans keep their
        # existing preparation; their support sequence must not be guessed.
        steps = self.plan['steps']
        diagonal_walk = len(steps)==10 and \
            [s['position'].lower() for s in steps]==['up','up','back','down','down','up','up','forward','down','down'] and \
            len(set(steps[i]['channel'] for i in (0,1,2,5,6)))==5 and \
            all(steps[a]['channel']==steps[b]['channel'] for a,b in ((0,3),(1,4),(2,7),(5,8),(6,9)))
        # Establish support first. Do NOT pre-position the walking slide with
        # all feet down: the first real gait phase lifts its diagonal before
        # moving the slide. From an unknown slide position that first stroke
        # may be shorter; dragging planted feet is not a valid homing method.
        final = {}
        for step in self.plan["steps"]:
            final[step["channel"]] = step
        preparation = sorted(final.values(), key=lambda s: s["position"].lower() != "down")
        if diagonal_walk:
            preparation = [s for s in preparation if s['channel'] != steps[2]['channel']]
        # A walk omits the independent turn output. Re-engage Closed before
        # stepping so a previous release cannot leave it floating while walking.
        # NamedTurn already includes this output in its own final pose.
        for c in self.channels.channels:
            if c['enabled'] and c['calibrated'] and c['channel'] not in final and c['name'].strip().lower() in ('turn', 'body turn', 'rotation'):
                ends = {c['a_name'].lower(), c['b_name'].lower()}
                if ends == set(('open', 'closed')):
                    insert_at=next((i for i,s in enumerate(preparation) if s['position'].lower()!='down'),len(preparation))
                    preparation.insert(insert_at,dict(channel=c['channel'], position='Closed'))
        sequence = list(self.plan["steps"])
        if direction == "backward":
            # Reverse transitions, not merely the list of endpoint commands.
            # The old target for each channel becomes the inverse target.
            previous = dict(final)
            inverse = []
            for s in sequence:
                inverse.append(previous[s["channel"]])
                previous[s["channel"]] = s
            sequence = list(reversed(inverse))
        self.direction = direction
        self.continuous = continuous is True
        self.lease_at = time.ticks_ms()
        self.cycle_offset = 0
        self.step_offset = 0
        self.sequence = sequence
        # Pair only the exact taught diagonal gait, never arbitrary adjacent legs.
        self.paired = self.plan.get('paired_feet',True) and diagonal_walk
        self.bench = bench is True
        self.run_cycles = 1 if self.bench or self.continuous else (cycles if cycles is not None else self.plan.get("cycles", 1))
        self.pending = preparation + sequence * self.run_cycles
        self.preparation_steps = len(preparation)
        self.approved_cycle = 0
        self.preview_cycle = -1
        self.preview_deadline = 0
        self.waiting_for_vision = False
        self.index = 0
        self.wait_until = None
        self.started = time.ticks_ms()
        self.running = True
        self.error = None
        self.run_id += 1
        self._next()
        return self.status()

    def _next(self):
        if self.index >= len(self.pending):
            if not self.continuous:
                self.running = False
                return
            # Reuse one cycle in bounded memory, without re-preparing or waiting
            # for a phone round trip at the cycle boundary.
            self.cycle_offset += 1
            self.step_offset += self.index
            self.pending = self.sequence
            self.preparation_steps = 0
            self.index = 0
        completed = self.cycle_offset * len(self.sequence) + max(0, self.index - self.preparation_steps)
        if not self.bench and completed and completed % len(self.plan["steps"]) == 0:
            boundary = completed // len(self.plan["steps"])
            if self.preview_cycle == boundary:
                if time.ticks_diff(time.ticks_ms(), self.preview_deadline) >= 0:
                    self.approved_cycle = boundary - 1
                self.preview_cycle = -1  # one image grants only one next cycle
            if boundary > self.approved_cycle:
                self.waiting_for_vision = True
                self.vision_wait_started = time.ticks_ms()
                return
        self.phase_size=1
        phase=[self.pending[self.index]]
        if self.paired and self.index >= self.preparation_steps:
            offset=(self.index-self.preparation_steps)%len(self.sequence)
            if offset in (0,3,5,8):
                phase.append(self.pending[self.index+1])
                self.phase_size=2
        targets=[self._target(s) for s in phase]
        self.channels.move(targets, calibration=False,
                           speed=self.run_speed, parallel=len(targets)==2)

    def _target(self, s):
        target = dict(channel=s["channel"], position=s["position"])
        if s["position"].lower() == "up":
            c = self.channels.channels[s["channel"]]
            endpoints = {c['a_name'].lower(): c['a_us'], c['b_name'].lower(): c['b_us']}
            if "down" not in endpoints:
                raise ValueError("leg_needs_up_and_down_endpoints")
            pulse = round(endpoints['down'] + (endpoints['up'] - endpoints['down']) * self.plan.get('lift_percent', 50) / 100)
            target = dict(channel=s['channel'], pulse_us=pulse)
        return target

    def keepalive(self, run_id):
        if not self.running or not self.continuous or run_id != self.run_id:
            raise ValueError('no_matching_continuous_walk')
        if time.ticks_diff(time.ticks_ms(), self.lease_at)>3000:
            self.error='manual_control_timed_out'
            self.cancel()
            raise ValueError(self.error)
        self.lease_at=time.ticks_ms()
        return self.status()

    def preview_next_cycle(self, run_id, next_cycle, path_clear, capture_offset_ms):
        """Approve one imminent boundary from a fresh view captured while moving."""
        if not self.running or self.bench or run_id != self.run_id:
            raise ValueError('no_matching_visual_walk')
        count = self.cycle_offset + max(0, self.index - self.preparation_steps) // len(self.plan['steps'])
        expected = count if self.waiting_for_vision else count + 1
        if type(next_cycle) is not int or next_cycle != expected or (not self.continuous and next_cycle >= self.run_cycles):
            raise ValueError('stale_cycle_preview')
        if path_clear is not True or type(capture_offset_ms) is not int or not 0 <= capture_offset_ms <= 1800000:
            raise ValueError('fresh_cycle_preview_required')
        # The phone measures capture relative to receipt of the run ACK. That
        # timestamp is later than self.started, so this intentionally ages the
        # frame conservatively and includes transport/queue delay on delivery.
        age = time.ticks_diff(time.ticks_ms(), self.started) - capture_offset_ms
        if age < 0 or age >= 2500:
            raise ValueError('stale_cycle_preview')
        self.preview_cycle = next_cycle
        self.preview_deadline = time.ticks_add(time.ticks_ms(), 2500 - age)
        self.approved_cycle = next_cycle
        if self.waiting_for_vision:
            self.waiting_for_vision = False
            self._next()
        return self.status()

    def continue_after_vision(self, run_id, completed_cycles, path_clear):
        if not self.running or not self.waiting_for_vision or run_id != self.run_id:
            raise ValueError("no_matching_walk_waiting_for_vision")
        count = self.cycle_offset + (self.index - self.preparation_steps) // len(self.plan["steps"])
        if completed_cycles != count or path_clear is not True:
            raise ValueError("fresh_cycle_vision_required")
        self.approved_cycle = count
        self.preview_cycle = -1
        self.waiting_for_vision = False
        self._next()
        return self.status()

    def cancel(self, release=True):
        self.running = False
        self.pending = []
        self.wait_until = None
        self.waiting_for_vision = False
        if release:
            self.channels.stop()
        else:
            self.channels.active = None
            self.channels.queue = []

    def step(self):
        if not self.running:
            return
        now = time.ticks_ms()
        try:
            if self.continuous and time.ticks_diff(now,self.lease_at)>3000:
                raise ValueError('manual_control_timed_out' if self.bench else 'walking_supervisor_timed_out')
            if self.waiting_for_vision:
                if time.ticks_diff(now, self.vision_wait_started) > 45000:
                    self.error = "vision_check_timed_out"
                    self.cancel(release=False)
                return
            if not self.continuous and time.ticks_diff(now, self.started) > 180000 * self.run_cycles:
                raise ValueError("walk_timed_out")
            if not self.channels.owning:
                raise ValueError("walk_interrupted")
            if self.channels.active is not None or self.channels.queue:
                return
            if self.wait_until is None:
                self.wait_until = now
                return
            if time.ticks_diff(now, self.wait_until) < self.plan.get('settle_ms',20):
                return
            self.wait_until = None
            self.index += self.phase_size
            self._next()
        except Exception as e:
            self.error = str(e)
            self.cancel()

    def status(self):
        cycles = self.run_cycles
        plan = self.plan if isinstance(self.plan, dict) else {}
        steps = plan.get("steps", [])
        steps_per_cycle = max(1, len(steps)) if isinstance(steps, list) else 1
        completed_cycles = self.cycle_offset + min(cycles, max(0, self.index - getattr(self, "preparation_steps", 0)) // steps_per_cycle)
        return dict(available=bool(self.plan), error=self.error, running=self.running,
                    run_id=self.run_id, completed_steps=self.step_offset+self.index,
                    cycles=cycles, completed_cycles=completed_cycles,
                    protocol=2, waiting_for_vision=self.waiting_for_vision,
                    moving_vision=True, visual_continuous=True, per_request_cycles=True, preview_max_age_ms=2500,
                    preview_cycle=self.preview_cycle,
                    direction=self.direction, bench=self.bench,
                    speed_us_s=self.run_speed if self.run_speed is not None else plan.get("speed_us_s",150),
                    pace_control=True, pace_speeds={'creep':200,'slow':600,'fast':1000,'run':1600},
                    max_speed_us_s=1600, settle_ms=plan.get('settle_ms',20),
                    smooth_walk=True, continuous=self.continuous,
                    paired_feet=getattr(self,'paired',False), manual_lease_ms=3000,
                    total_steps=None if self.continuous else len(self.pending), physical_feedback=False)
