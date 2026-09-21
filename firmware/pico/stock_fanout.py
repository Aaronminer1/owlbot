"""Stock GrowBot L/R compatibility for a calibrated four-leg BENCH test.

Two input coordinates fan out to four leg outputs. This is not a learned gait
for the slide-driven body: slide, turn and head are deliberately NOT outputs.
Both streamed poses and gesture keyframes use map_pose(). No PWM on startup.
"""
import math
import time


class StockFanout:
    # Owner-observed full tucking bound all four legs. Match this body's saved
    # walking lift (50%), without rewriting its independently calibrated ends.
    # This is a stock-lane ceiling, not proof a simultaneous folded pose clears
    # the linkage. Increasing it requires another physical commissioning test.
    MAX_LIFT_PERCENT = 50
    SPEED_US_S = 600
    POSE_TIMEOUT_MS = 500
    HOLD_MS = 250
    ROLES = (('l', 'left front leg'), ('l', 'left rear leg'),
             ('r', 'right front leg'), ('r', 'right rear leg'))

    def __init__(self, channels):
        self.channels = channels
        self.mode = 'idle'
        self.targets = {}
        self.last_lr = (90.0, 90.0)
        self.frames = []
        self.frame = None
        self.received = 0
        self.tick_at = time.ticks_ms()
        self.error = None

    @property
    def active(self):
        return self.mode != 'idle'

    @staticmethod
    def angle(value):
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError('finite_stock_angle_required')
        return max(0.0, min(180.0, value))

    def mapping(self):
        rows = []
        for side, name in self.ROLES:
            found = [c for c in self.channels.channels if c['name'].strip().lower() == name]
            if len(found) != 1:
                raise ValueError('unique_named_leg_required:' + name)
            c = found[0]
            ends = {c['a_name'].lower():c['a_us'], c['b_name'].lower():c['b_us']}
            if not c['enabled'] or not c['calibrated'] or set(ends) != {'up','down'}:
                raise ValueError('calibrated_up_down_leg_required:' + name)
            # GrowBot's legs are mirrored: low L + high R is its down/stand
            # direction. Translate meaning, never reuse its degree-to-us map.
            rows.append(dict(channel=c['channel'], side=side, name=c['name'],
                zero=ends['down' if side=='l' else 'up'], center=c['center_us'],
                full=ends['up' if side=='l' else 'down'], down=ends['down'],
                up_limit=round(ends['down']+(ends['up']-ends['down'])*self.MAX_LIFT_PERCENT/100)))
        if len({r['channel'] for r in rows}) != 4:
            raise ValueError('stock_leg_channels_overlap')
        return rows

    def map_pose(self, left, right):
        left, right = self.angle(left), self.angle(right)
        result = {}
        for row in self.mapping():
            angle = left if row['side']=='l' else right
            pulse = (row['zero']+(row['center']-row['zero'])*angle/90 if angle<=90
                     else row['center']+(row['full']-row['center'])*(angle-90)/90)
            # Clamp only the tucked-up side. Do not rescale neutral/downward
            # commands, invert mounts, or use numerical min as anatomical Up.
            result[row['channel']] = self.bound_pulse(row, round(pulse))
        return result

    @staticmethod
    def bound_pulse(row, pulse):
        return max(min(row['down'],row['up_limit']),
                   min(max(row['down'],row['up_limit']),pulse))

    def _begin(self):
        if self.active:
            return
        if self.channels.active is not None or self.channels.queue:
            raise ValueError('finish_named_or_manual_motion_first')
        # Preserve known commanded positions across a lane handover. They are
        # not encoder readings; after release the actual positions are unknown.
        previous = dict(self.channels.current)
        self.channels.stop()
        self.channels.current = previous
        self.channels.owning = True
        self.tick_at = time.ticks_ms()
        self.error = None

    def pose(self, left, right):
        targets = self.map_pose(left, right)  # validate before taking outputs
        self._begin()
        self.frames = []; self.frame = None
        self.targets = targets
        self.last_lr = (self.angle(left), self.angle(right))
        self.mode = 'pose'; self.received = time.ticks_ms()
        return self.status()

    def enqueue(self, steps, mode='replace'):
        if mode not in ('replace','append') or not isinstance(steps,list) or not 1<=len(steps)<=64:
            raise ValueError('invalid_stock_gesture')
        clean = []
        for step in steps:
            if not isinstance(step,dict):raise ValueError('invalid_stock_frame')
            left,right = self.angle(step.get('l')),self.angle(step.get('r'))
            ms = step.get('ms')
            if type(ms) is not int or not 20<=ms<=10000:
                raise ValueError('stock_frame_duration_20_to_10000_ms')
            clean.append(dict(l=left,r=right,ms=ms))
        queued = self.queued_ms() if mode=='append' and self.mode=='act' else 0
        existing = len(self.frames)+(1 if self.frame else 0) if queued else 0
        if len(clean)+existing>64 or queued+sum(s['ms'] for s in clean)>60000:
            raise ValueError('stock_gesture_queue_full')
        self.map_pose(clean[0]['l'],clean[0]['r'])
        self._begin()
        if mode=='replace' or self.mode!='act':
            self.frames=[];self.frame=None
        self.frames.extend(clean)
        self.mode='act'
        return self.queued_ms()

    def queued_ms(self):
        remaining = max(0,self.frame['ms']-time.ticks_diff(time.ticks_ms(),self.frame_at)) if self.frame else 0
        return remaining+sum(s['ms'] for s in self.frames)

    def stop(self):
        if not self.active:return
        self.mode='idle';self.frames=[];self.frame=None
        # Only this lane's four leg outputs. Never turn a head release into an
        # unexpected head movement, or touch the slide/turn as an L/R guess.
        for ch in self.targets:
            self.channels.board.release(ch+1)
            self.channels.current.pop(ch,None)
        self.targets={}
        self.channels.owning=False

    def engagement_position(self,ch):
        return self.channels.channels[ch]['center_us']

    def step(self):
        if not self.active:return
        now=time.ticks_ms()
        elapsed=time.ticks_diff(now,self.tick_at)
        if elapsed<20:return
        self.tick_at=now
        if self.mode=='pose' and time.ticks_diff(now,self.received)>self.POSE_TIMEOUT_MS:
            self.stop();return
        if self.mode=='hold' and time.ticks_diff(now,self.hold_at)>self.HOLD_MS:
            self.stop();return
        try:
            if self.mode=='act':
                if self.frame is None:
                    self.frame=self.frames.pop(0);self.frame_at=now;self.start_lr=self.last_lr
                f=self.frame
                fraction=min(1,max(0,time.ticks_diff(now,self.frame_at)/f['ms']))
                eased=fraction*fraction*(3-2*fraction)
                left=self.start_lr[0]+(f['l']-self.start_lr[0])*eased
                right=self.start_lr[1]+(f['r']-self.start_lr[1])*eased
                self.targets=self.map_pose(left,right)
                self.last_lr=(left,right)
                if fraction>=1:
                    self.frame=None
                    if not self.frames:self.mode='hold';self.hold_at=now
            distance=self.SPEED_US_S*min(40,elapsed)/1000
            rows={r['channel']:r for r in self.mapping()}
            for ch,target in self.targets.items():
                old=self.channels.current.get(ch,self.engagement_position(ch))
                # A previous lane or released-position seed can be outside the
                # stock envelope. Never emit an over-limit intermediate pulse.
                old=self.bound_pulse(rows[ch],old)
                pulse=max(old-distance,min(old+distance,target))
                pulse=self.bound_pulse(rows[ch],pulse)
                self.channels.current[ch]=pulse
                self.channels.board.servoWriteMicros(ch+1,round(pulse))
        except Exception as error:
            self.error=str(error);self.stop()

    def status(self):
        try: mapping=self.mapping();mapping_error=None
        except Exception as error: mapping=[];mapping_error=str(error)
        return dict(mode=self.mode,active=self.active,mapping=mapping,
            mapping_error=mapping_error,error=self.error,targets=dict(self.targets),
            last_lr=list(self.last_lr),queued_ms=self.queued_ms(),speed_us_s=self.SPEED_US_S,
            pose_timeout_ms=self.POSE_TIMEOUT_MS,physical_feedback=False,
            max_lift_percent=self.MAX_LIFT_PERCENT,
            bench_fanout=True,locomotion_verified=False,head_outputs=False,
            slide_output=False,turn_output=False)
