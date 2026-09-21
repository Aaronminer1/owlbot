"""App-neutral commands translated to the existing calibrated Pico executors.

No gait, PWM loop, network connection or identity lives here. Both clients use
the same NamedGait/NamedTurn/PicoHead objects through relay_chip._handle. Keep
the established dog_cal envelope: relays may filter unknown top-level types.
"""


class SharedBody:
    def __init__(self, channels, head):
        self.channels = channels
        self.head = head

    def capabilities(self):
        # Discovery must not call head.status(), which renews its holding lease.
        return dict(version=1, executor="pico_named", physical_feedback=False,
                    commands=["status", "walk", "turn", "head", "stop",
                              "keepalive", "preview", "continue", "head_stop"],
                    paces=["creep", "slow", "fast", "run"],
                    continuous=True, camera_on_client=True,
                    keepalive_ms=1000, lease_ms=3000, preview_max_age_ms=2500,
                    simultaneous_walk_turn=False, head_max_speed_us_s=150,
                    turn_requires_pattern_a_direction=True,
                    head_coordinates="pan:left=-1,right=1;tilt:down=-1,up=1",
                    stock_two_leg_pose_compatible=True,
                    stock_pose_mode='posture_or_alternating_support',stock_locomotion_verified=False,
                    stock_steering_decoded=False,stock_browser_changes_required=False)

    def resolve(self, message):
        if type(message.get("body_version")) is not int or message['body_version'] != 1:
            raise ValueError("unsupported_body_version")
        verb = message.get("body_action")
        # Copy only allowed arguments: no hidden bench override or raw PWM.
        out = dict(t="dog_cal", rid=message.get("rid"))
        fields = ()
        if verb == "status":
            action = "info"
        elif verb == "walk":
            action = "walk_run"
            fields = ("direction", "path_clear", "continuous", "pace", "cycles")
        elif verb == "turn":
            action = "turn_run"
            direction = message.get("direction")
            observed = message.get("pattern_a_direction")
            if direction not in ("left", "right") or observed not in ("left", "right"):
                raise ValueError("observed_turn_mapping_required")
            candidates = [c for c in self.channels.channels
                          if c['enabled'] and c['calibrated']
                          and c['name'].strip().lower() in ('turn', 'body turn', 'rotation')
                          and {c['a_name'].lower(), c['b_name'].lower()} == {'open', 'closed'}]
            if len(candidates) != 1:
                raise ValueError("unique_calibrated_turn_channel_required")
            c = candidates[0]
            out.update(turn_channel=c['channel'],
                       binding={k: c[k] for k in ('name', 'a_name', 'b_name', 'a_us', 'b_us', 'center_us')},
                       pattern='a' if direction == observed else 'b',
                       fraction=message.get('fraction', 1))
        elif verb == "head":
            action = "head_move"
            axis, value = message.get('axis'), message.get('position')
            if axis not in ('pan', 'tilt') or type(value) not in (int, float) or not -1 <= value <= 1:
                raise ValueError("invalid_semantic_head_position")
            cfg = self.head.config()[axis]
            c = self.channels.channels[cfg['channel']]
            negative, positive = ('left', 'right') if axis == 'pan' else ('down', 'up')
            endpoints = {c['a_name'].strip().lower(): c['a_us'], c['b_name'].strip().lower(): c['b_us']}
            if set(endpoints) != {negative, positive}:
                raise ValueError("semantic_head_endpoint_labels_required")
            # Tilt Up can be a SMALLER pulse than Down. Use saved labels, not
            # sorted electrical limits; leave legacy OwlBot inversion intact.
            target = endpoints[positive if value >= 0 else negative]
            out.update(axis=axis, pulse=round(cfg['center'] + abs(value) * (target - cfg['center'])))
        elif verb == "stop":
            action = "stop"
        elif verb == "head_stop":
            action = "head_stop"
        elif verb == "keepalive":
            lane = message.get('lane')
            if lane not in ('walk', 'turn', 'head'):
                raise ValueError("invalid_body_lane")
            action = 'head_info' if lane == 'head' else lane + '_keepalive'
            fields = ('run_id',)
        elif verb == "preview":
            action = "walk_preview"
            fields = ('run_id', 'next_cycle', 'path_clear', 'capture_offset_ms')
        elif verb == "continue":
            action = "walk_continue"
            fields = ('run_id', 'completed_cycles', 'path_clear')
        else:
            raise ValueError("unknown_body_action")
        out['channel_action'] = action
        for key in fields:
            if key in message:
                out[key] = message[key]
        return out
