"""Owner-defined Waveshare channels, named endpoints and paced calibration.

Configuration and startup emit no PWM. Positions are commanded values, not
physical feedback. Calibration ramps at <= 150 us/s and one channel at a time.
"""
import json
import os
import time

CONFIG_FILE = "servo_channels.json"


class ServoChannels:
    def __init__(self, board, dog, gaze, filename=CONFIG_FILE):
        self.board, self.dog, self.gaze = board, dog, gaze
        self.filename = filename
        self.channels = []
        self.current = {}
        self.queue = []
        self.active = None
        self.last_tick = None
        self.calibration = False
        self.parallel = False
        self.owning = False
        self.speed = 100
        self.config_error = None
        for ch in range(16):
            self.channels.append(dict(channel=ch, enabled=False, name="Channel %d" % ch,
                group="", a_name="Position A", a_us=1400, b_name="Position B", b_us=1600,
                center_us=1500, locked=True, calibrated=False))
        # Import installed assignments once; they remain editable, not reserved.
        for role, ch in dog.ports_dict().items():
            lo, hi = dog.limits[role]
            leg = role in dog.lift_endpoints
            up = dog.lift_endpoints.get(role) == "min"
            self.channels[ch].update(enabled=True, name=role.replace("_", " "),
                group="legs" if leg else "body", a_name="Up" if leg else "Back" if role=="slider" else "Left",
                b_name="Down" if leg else "Forward" if role=="slider" else "Right",
                a_us=lo if not leg or up else hi, b_us=hi if not leg or up else lo,
                center_us=max(lo,min(hi,int(dog.current[role]))), locked=bool(dog.locks.get(role)),
                calibrated=False)
        for role, ch in gaze.ports_dict().items():
            pan = role=="gimbal_pan"
            lo = gaze.pan_min_us if pan else gaze.tilt_min_us
            hi = gaze.pan_max_us if pan else gaze.tilt_max_us
            self.channels[ch].update(enabled=True,name="Head pan" if pan else "Head tilt",group="head",
                a_name="Left" if pan else "Up",b_name="Right" if pan else "Down",a_us=lo,b_us=hi,
                center_us=gaze.pan_center_us if pan else gaze.tilt_center_us,
                locked=bool(gaze.locks.get(role)),calibrated=False)
        try:
            with open(filename) as f:
                loaded=json.load(f)
            if len(loaded)!=16:
                raise ValueError("channel_count")
            self.channels=[self.validate(c, i) for i,c in enumerate(loaded)]
        except OSError as exc:
            if not exc.args or exc.args[0] != 2:
                self.config_error = "saved_configuration_unreadable"
        except (ValueError,KeyError,TypeError):
            self.config_error = "saved_configuration_invalid"
        if self.config_error:
            # A damaged saved file must never silently widen physical travel.
            for c in self.channels:
                c.update(enabled=False,locked=True,calibrated=False)
        self.apply_rules()

    @staticmethod
    def validate(data, ch):
        out=dict(channel=ch)
        for key in ("name","group","a_name","b_name"):
            out[key]=str(data.get(key,"")).strip()[:48]
        if not out["name"] or not out["a_name"] or not out["b_name"] or out["a_name"].lower()==out["b_name"].lower():
            raise ValueError("name_each_endpoint_differently")
        for key in ("a_us","b_us","center_us"):
            n=data.get(key)
            if isinstance(n,bool) or int(n)!=float(n) or not 500<=int(n)<=2500:
                raise ValueError("pulse_must_be_500_to_2500")
            out[key]=int(n)
        if out["a_us"]==out["b_us"] or not min(out["a_us"],out["b_us"])<=out["center_us"]<=max(out["a_us"],out["b_us"]):
            raise ValueError("center_must_be_between_endpoints")
        for key in ("enabled","locked","calibrated"):
            out[key]=bool(data.get(key,False))
        return out

    def apply_rules(self):
        # Every old gait/gaze path is clamped by the same saved physical limits.
        self.board.channel_rules={c["channel"]+1:c for c in self.channels}
        for role,ch in self.dog.ports_dict().items():
            c=self.channels[ch]
            self.dog.limits[role]=[min(c["a_us"],c["b_us"]),max(c["a_us"],c["b_us"])]
            if role in self.dog.lift_endpoints:
                up=c["a_us"] if c["a_name"].lower()=="up" else c["b_us"] if c["b_name"].lower()=="up" else None
                if up is not None:self.dog.lift_endpoints[role]="min" if up==min(c["a_us"],c["b_us"]) else "max"

    def configure(self, data):
        ch=int(data["channel"])
        if ch<0 or ch>15:raise ValueError("invalid_channel")
        candidate=self.validate(data,ch)
        old=self.channels[ch]
        if old["locked"] and any(candidate[k]!=old[k] for k in candidate if k!="locked"):
            raise ValueError("unlock_channel_first")
        if candidate["enabled"] and any(c["channel"]!=ch and c["enabled"] and c["name"].lower()==candidate["name"].lower() for c in self.channels):
            raise ValueError("give_each_servo_a_unique_name")
        updated=list(self.channels);updated[ch]=candidate
        tmp=self.filename+".tmp"
        with open(tmp,"w") as f:json.dump(updated,f)
        getattr(os,"replace",os.rename)(tmp,self.filename)
        self.channels=updated
        if self.active or self.queue:self.stop()
        self.config_error=None
        self.apply_rules()
        if not candidate["enabled"]:
            self.board.release(ch+1)
        return dict(candidate)

    def stop(self):
        if hasattr(self, 'stop_stock'): self.stop_stock()
        if hasattr(self, 'stop_head'): self.stop_head()
        self.owning=False
        self.queue=[];self.active=None;self.last_tick=None
        self.current={}
        self.board.calibration_port=None
        self.board.releaseAll()

    def move(self, targets, calibration=False, speed=100, parallel=False):
        if not isinstance(targets,list) or not 1<=len(targets)<=16:
            raise ValueError("one_to_sixteen_targets_required")
        if parallel and (calibration or len(targets)>2):
            raise ValueError("paired_movement_is_not_calibration")
        validated=[]
        for target in targets:
            ch=int(target["channel"])
            if ch<0 or ch>15:raise ValueError("invalid_channel")
            c=self.channels[ch]
            if not c["enabled"]:raise ValueError("channel_not_enabled")
            if calibration and c["locked"]:raise ValueError("unlock_for_calibration")
            if not calibration and not c["calibrated"]:raise ValueError("record_named_endpoints_first")
            endpoint=str(target.get("position","")).strip().lower()
            if endpoint:
                if endpoint==c["a_name"].lower():pulse=c["a_us"]
                elif endpoint==c["b_name"].lower():pulse=c["b_us"]
                elif endpoint=="center":pulse=c["center_us"]
                else:raise ValueError("unknown_named_position")
            else:pulse=int(target["pulse_us"])
            lo,hi=(500,2500) if calibration else (min(c["a_us"],c["b_us"]),max(c["a_us"],c["b_us"]))
            if not lo<=pulse<=hi:raise ValueError("outside_saved_travel")
            validated.append((ch,pulse))
        if parallel and len(set(ch for ch,pulse in validated)) != len(validated):
            raise ValueError("duplicate_paired_channel")
        if hasattr(self, 'stop_stock'): self.stop_stock()
        if not self.owning:
            self.dog.release();self.gaze.release()
            self.current={}
        self.owning=True
        self.queue=validated;self.active=None;self.last_tick=None
        self.parallel=bool(parallel)
        head_ports=set(self.gaze.ports_dict().values())
        head_move=any(ch in head_ports or self.channels[ch].get('group')=='head' for ch,pulse in validated)
        self.calibration=bool(calibration);self.speed=max(20,min(150 if calibration or head_move else 1600,int(speed)))
        return len(validated)

    def engagement_position(self, ch):
        c = self.channels[ch]
        # A released servo has no measured position. For the calibrated body
        # turn, first command its known Closed endpoint, not a partly-open
        # midpoint. This is a command seed, never proof of physical closure.
        if not self.calibration and c['name'].strip().lower() in ('turn', 'body turn', 'rotation'):
            ends = {c['a_name'].lower(): c['a_us'], c['b_name'].lower(): c['b_us']}
            if set(ends) == set(('open', 'closed')):
                return ends['closed']
        return c['center_us']

    def step(self):
        now=time.ticks_ms()
        if self.last_tick is None:self.last_tick=now
        elapsed=time.ticks_diff(now,self.last_tick)
        if elapsed<20:return
        self.last_tick=now
        if self.parallel:
            remaining=[]
            for ch,target in self.queue:
                current=self.current.get(ch,self.engagement_position(ch))
                delta=target-current
                step=max(1,self.speed*min(elapsed,40)/1000)
                current=target if abs(delta)<=step else current+(step if delta>0 else -step)
                self.current[ch]=current
                self.board.servoWriteMicros(ch+1,int(current))
                if current!=target:remaining.append((ch,target))
            self.queue=remaining
            self.active=remaining[0] if remaining else None
            return
        if self.active is None:
            if not self.queue:return
            self.active=self.queue.pop(0)
        ch,target=self.active
        c=self.channels[ch]
        # No encoder: this seed is not a measurement of the released horn.
        current=self.current.get(ch,self.engagement_position(ch))
        delta=target-current
        step=max(1,self.speed*min(elapsed,40)/1000)
        current=target if abs(delta)<=step else current+(step if delta>0 else -step)
        self.current[ch]=current
        self.board.calibration_port=ch+1 if self.calibration else None
        try:self.board.servoWriteMicros(ch+1,int(current))
        finally:self.board.calibration_port=None
        if current==target:self.active=None

    def status(self):
        return dict(channels=self.channels,active=self.active[0] if self.active else None,
            queued=len(self.queue),commanded={str(k):int(v) for k,v in self.current.items()},
            physical_feedback=False,config_error=self.config_error)
