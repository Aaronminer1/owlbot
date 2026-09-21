"""One owner-taught diagonal turn. No guessed opposite-direction gait."""
from named_gait import NamedGait
import time

class NamedTurn(NamedGait):
    def __init__(self, channels):
        super().__init__(channels, 'named_turn.json')
        self.plan=None
        self.error=None

    def start_turn(self, walk, turn_channel, binding, pattern='a', fraction=1):
        if self.running: raise ValueError('turn_already_running')
        if pattern not in ('a','b'): raise ValueError('unknown_turn_pattern')
        if type(fraction) not in (int, float) or not 0.02 <= fraction <= 1:
            raise ValueError('turn_fraction_must_be_0.02_to_1')
        self.validate(walk)
        steps=walk['steps']
        expected=['up','up','back','down','down','up','up','forward','down','down']
        if len(steps)!=10 or [s['position'].lower() for s in steps]!=expected:
            raise ValueError('turn_needs_taught_diagonal_walk')
        if not all(steps[a]['channel']==steps[b]['channel'] for a,b in ((0,3),(1,4),(2,7),(5,8),(6,9))):
            raise ValueError('invalid_diagonal_bindings')
        roles=[steps[i]['channel'] for i in (0,1,5,6)]
        if type(turn_channel) is not int or not 0<=turn_channel<=15 or len(set(roles+[steps[2]['channel'],turn_channel]))!=6:
            raise ValueError('turn_requires_separate_calibrated_output')
        c=self.channels.channels[turn_channel]
        keys=('name','a_name','b_name','a_us','b_us','center_us')
        if not c['enabled'] or not c['calibrated'] or binding!={k:c[k] for k in keys}:
            raise ValueError('turn_channel_changed_reload_settings')
        endpoints={c['a_name'].lower():c['a_us'],c['b_name'].lower():c['b_us']}
        if set(endpoints)!=set(('open','closed')): raise ValueError('label_turn_endpoints_open_and_closed')
        def turn_step(pulse):
            return dict(channel=turn_channel,position=c['a_name'] if pulse==c['a_us'] else c['b_name'],binding=dict(binding))
        # Both patterns start and finish CLOSED. Swap supporting diagonals to
        # reverse yaw; physical left/right is identified on the assembled robot.
        first,second=((5,6,8,9),(0,1,3,4)) if pattern=='a' else ((0,1,3,4),(5,6,8,9))
        sequence=[steps[first[0]],steps[first[1]],turn_step(endpoints['open']),steps[first[2]],steps[first[3]],
                  steps[second[0]],steps[second[1]],turn_step(endpoints['closed']),steps[second[2]],steps[second[3]]]
        plan=dict(version=1,name='Taught Turn',cycles=1,steps=sequence,
                  speed_us_s=walk.get('speed_us_s',150),lift_percent=walk.get('lift_percent',50),
                  paired_feet=True,settle_ms=walk.get('settle_ms',20))
        self.validate(plan)
        if self.channels.active is not None or self.channels.queue: raise ValueError('movement_active')
        self.plan=plan
        self.pattern=pattern
        self.turn_channel=turn_channel
        self.fraction=fraction
        self.partial_open=round(endpoints['closed']+(endpoints['open']-endpoints['closed'])*fraction)
        self.lease_at=time.ticks_ms()
        super().start(bench=True)
        # The parent recognizes walking labels only. This exact validated
        # ten-step turn has the same paired phase indices; preparation is single.
        self.paired=True
        return self.status()

    def _target(self, step):
        if step['channel']==self.turn_channel and step['position'].lower()=='open':
            return dict(channel=self.turn_channel, pulse_us=self.partial_open)
        return super()._target(step)

    def keepalive(self, run_id):
        if not self.running or run_id!=self.run_id: raise ValueError('no_matching_turn')
        if time.ticks_diff(time.ticks_ms(),self.lease_at)>3000:
            self.error='turn_control_timed_out';self.cancel();raise ValueError(self.error)
        self.lease_at=time.ticks_ms()
        return self.status()

    def step(self):
        if self.running and time.ticks_diff(time.ticks_ms(),self.lease_at)>3000:
            self.error='turn_control_timed_out';self.cancel();return
        super().step()

    def status(self):
        result=super().status()
        result.update(available=True,kind='taught_turn',direction='unverified',return_endpoint='closed',
                      turn_protocol=2,pattern=getattr(self,'pattern',None),
                      partial_turn=True,turn_fraction=getattr(self,'fraction',1))
        return result
