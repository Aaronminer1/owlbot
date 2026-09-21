"""Chip-side coupling of stock two-leg signals to the slide-driven body.

No browser hooks or synthetic camera approval. Pose packets contain positions,
not intention labels: this profile interprets sustained alternating virtual-leg
support as stepping. Streamed neutral is feet Down; act/routine gestures retain
the bounded StockFanout mapping.
It cannot recover steering intent when the sender emits identical L/R signals.
"""
import time
from stock_fanout import StockFanout


class StockBody(StockFanout):
    PHASE_THRESHOLD = 18
    MIN_REVERSAL_MS = 100
    MAX_REVERSAL_MS = 1100
    NEUTRAL_STOP_MS = 200

    def __init__(self, channels, walk):
        super().__init__(channels)
        self.walk = walk
        self.walking = False
        self.internal_move = False
        self.completed_cycles = 0
        self.completed_phases = 0
        self.phases = []
        self.phase_index = 0
        self.last_input = None
        self.run_id = 0
        self.last_stop_reason = None
        self.last_stop_cycles = 0
        self.last_pose_gap_ms = None
        self.walk_lift_ceiling = 60
        self._reset_pattern()

    def _reset_pattern(self):
        self.sign = 0
        self.reversals = 0
        self.reversed_at = None
        self.neutral_at = None

    def _sample(self, left, right, now):
        self.last_pose_gap_ms=None if self.last_input is None else time.ticks_diff(now,self.last_input)
        if self.last_input is None or time.ticks_diff(now,self.last_input)>self.POSE_TIMEOUT_MS:
            self._reset_pattern()
        self.last_input = now
        # Virtual legs are mirrored. Difference of their lift fractions is
        # proportional to L + R - 180, NOT L - R. Uniform tuck/stand stays zero.
        contrast = left + right - 180
        sign = 1 if contrast>=self.PHASE_THRESHOLD else -1 if contrast<=-self.PHASE_THRESHOLD else 0
        if not sign:
            if self.neutral_at is None:self.neutral_at=now
            if time.ticks_diff(now,self.neutral_at)>=self.NEUTRAL_STOP_MS:
                self._reset_pattern()
                if self.walking:self.stop('neutral_pose_held')
            return False
        self.neutral_at=None
        if not self.sign:
            self.sign=sign;self.reversed_at=now
        elif sign!=self.sign:
            gap=time.ticks_diff(now,self.reversed_at)
            self.reversals=self.reversals+1 if self.MIN_REVERSAL_MS<=gap<=self.MAX_REVERSAL_MS else 0
            self.sign=sign;self.reversed_at=now
        return self.reversals>=2

    def _make_phases(self):
        self.walk.validate(self.walk.plan)
        steps=self.walk.plan['steps']
        labels=['up','up','back','down','down','up','up','forward','down','down']
        if len(steps)!=10 or [s['position'].lower() for s in steps]!=labels:
            raise ValueError('stock_step_needs_taught_diagonal_sequence')
        if not all(steps[a]['channel']==steps[b]['channel'] for a,b in ((0,3),(1,4),(2,7),(5,8),(6,9))):
            raise ValueError('stock_step_bindings_mismatch')
        if len({steps[i]['channel'] for i in (0,1,2,5,6)})!=5:
            raise ValueError('stock_step_channels_overlap')
        # Require the actual named four legs and Slide, not arbitrary learned
        # endpoint names that happen to spell Up/Down/Back/Forward.
        legs={r['channel'] for r in self.mapping()}
        if {steps[i]['channel'] for i in (0,1,5,6)}!=legs:
            raise ValueError('stock_step_leg_map_mismatch')
        slide=self.channels.channels[steps[2]['channel']]
        if slide['name'].strip().lower() not in ('slide','slider'):
            raise ValueError('stock_step_needs_slide')
        turns=[c for c in self.channels.channels if c['enabled'] and c['calibrated']
               and c['name'].strip().lower() in ('turn','body turn','rotation')
               and {c['a_name'].lower(),c['b_name'].lower()}=={'open','closed'}]
        if len(turns)!=1 or turns[0]['channel'] in legs|{slide['channel']}:
            raise ValueError('stock_step_needs_unique_closed_turn')
        # Walking clearance is independent of the legacy all-leg tuck limit.
        # Keep fold/pose limits at 50%; admit at most 60% only in a validated
        # alternating diagonal walk, with each opposite pair supporting it.
        self.walk_lift_percent = min(self.walk_lift_ceiling, self.walk.plan.get('lift_percent',50))
        def target(step):
            t=self.walk._target(step)
            if step['position'].lower()=='up':
                c=self.channels.channels[step['channel']]
                ends={c['a_name'].lower():c['a_us'],c['b_name'].lower():c['b_us']}
                t['pulse_us']=round(ends['down']+(ends['up']-ends['down'])*self.walk_lift_percent/100)
            return t
        # Freeze validated targets for this run; calibration changes stop the
        # lane through the existing stop hook before taking manual ownership.
        self.cycle=[[target(steps[i]) for i in group] for group in
                    ((0,1),(2,),(3,4),(5,6),(7,),(8,9))]
        preparation=[[dict(channel=ch,position='Down')] for ch in sorted(legs)]
        preparation.append([dict(channel=turns[0]['channel'],position='Closed')])
        # Leave the slide alone until cycle[0] has lifted its diagonal. A
        # feet-down Forward reset here dragged the body before its first step.
        self.phases=preparation+self.cycle
        self.preparation_count=len(preparation)
        self.speed=min(1600,self.walk.plan.get('speed_us_s',600))

    def _start_steps(self):
        self._make_phases()  # reject before taking ownership
        previous=dict(self.channels.current)
        super().stop()
        self.channels.current=previous
        self.walking=True;self.mode='stock_walk';self.error=None
        self.run_id+=1;self.last_stop_reason=None
        self.frames=[];self.frame=None;self.targets={}
        self.completed_cycles=0;self.completed_phases=0;self.phase_index=0
        self._next_phase()

    def _next_phase(self):
        if self.phase_index>=len(self.phases):
            self.completed_cycles+=1
            self.phases=self.cycle;self.phase_index=0;self.preparation_count=0
        # move() normally preempts stock output. Only this synchronous internal
        # call bypasses that hook; external moves/stops still cancel immediately.
        self.internal_move=True
        try:self.channels.move(self.phases[self.phase_index],speed=self.speed,
                               parallel=len(self.phases[self.phase_index])==2)
        finally:self.internal_move=False

    def pose(self,left,right):
        left,right=self.angle(left),self.angle(right)
        now=time.ticks_ms()
        start=self._sample(left,right,now)
        self.last_lr=(left,right)
        if not self.walking and start:self._start_steps()
        if self.walking:
            self.received=now
            return self.status()
        # Stock walking first streams neutral 90/90. On this body neutral must
        # mean feet Down, not the calibrated midpoint (which tucks all legs).
        # Keep act/routine gesture mapping unchanged; only streamed virtual
        # legs use a Down-based stance and proportional half-range lift.
        super().pose(left,right)
        self.targets={}
        for row in self.mapping():
            lift=max(0,(left-90)/90 if row['side']=='l' else (90-right)/90)
            self.targets[row['channel']]=round(row['down']+(row['up_limit']-row['down'])*lift)
        return self.status()

    def engagement_position(self,ch):
        if self.mode=='pose':
            c=self.channels.channels[ch]
            return c['a_us'] if c['a_name'].lower()=='down' else c['b_us']
        return super().engagement_position(ch)

    def enqueue(self,steps,mode='replace'):
        if self.walking:self.stop('gesture_preempted')
        self._reset_pattern();self.last_input=None
        return super().enqueue(steps,mode)

    def stop(self,reason='stop_or_manual_preemption'):
        if self.internal_move:return
        self._reset_pattern();self.last_input=None
        if self.walking:
            self.last_stop_reason=reason;self.last_stop_cycles=self.completed_cycles
            self.walking=False;self.mode='idle';self.phases=[];self.targets={}
            self.channels.queue=[];self.channels.active=None
            self.channels.owning=False;self.channels.current={}
            self.channels.board.releaseAll()
        else:super().stop()

    def step(self):
        if not self.walking:return super().step()
        now=time.ticks_ms()
        # A connection/pose lease is not enough: a frozen repeating last pose
        # must not keep the body walking. Ongoing reversals are also required.
        if self.last_input is None or time.ticks_diff(now,self.last_input)>self.POSE_TIMEOUT_MS:
            self.stop('pose_stream_timeout');return
        if self.reversed_at is None or time.ticks_diff(now,self.reversed_at)>self.MAX_REVERSAL_MS:
            self.stop('support_pattern_timeout');return
        try:
            if not self.channels.owning:raise ValueError('stock_steps_preempted')
            if self.channels.active is not None or self.channels.queue:return
            self.phase_index+=1;self.completed_phases+=1
            self._next_phase()
        except Exception as error:self.error=str(error);self.stop('executor_error')

    def status(self):
        out=super().status()
        out['stock_walk']=dict(running=self.walking,profile='alternating_virtual_support',
            run_id=self.run_id,last_stop_reason=self.last_stop_reason,
            last_stop_cycles=self.last_stop_cycles,last_pose_gap_ms=self.last_pose_gap_ms,
            direction='configured_forward_not_inferred',completed_cycles=self.completed_cycles,
            completed_phases=self.completed_phases,reversals=self.reversals,
            phase_timeout_ms=self.MAX_REVERSAL_MS,steering_decoded=False,
            lift_percent=getattr(self,'walk_lift_percent',min(self.walk_lift_ceiling,(self.walk.plan or {}).get('lift_percent',50))),
            physical_feedback=False)
        out['slide_output']=self.walking
        out['turn_output']='closed_only' if self.walking else False
        return out
