"""Atomic stationary-pose takeover; never release PWM between body owners.

Only a static pose/hold is transferable, never an active walk or queued gesture.
The successor must start synchronously in the same dispatcher call. There is no
standalone claim that could strand outputs while waiting on a network message.
"""
PROTOCOL = 'stock-pose-hold-v1'


def transfer(stock, channels, begin):
    if not stock.active:
        return begin()
    if (stock.mode not in ('pose', 'hold') or getattr(stock, 'walking', False)
            or stock.frames or stock.frame or stock.queued_ms()
            or channels.active is not None or channels.queue
            or not channels.owning or not stock.targets):
        raise ValueError('handoff_requires_stationary_owned_pose')
    for ch in stock.targets:
        c = channels.channels[ch]
        value = channels.current.get(ch)
        if (not c['enabled'] or not c['calibrated'] or value is None
                or not min(c['a_us'],c['b_us']) <= value <= max(c['a_us'],c['b_us'])):
            raise ValueError('handoff_requires_known_calibrated_commands')
    saved_stock = dict(stock.__dict__)
    saved_channels = dict(channels.__dict__)
    saved_channels['current'] = dict(channels.current)
    saved_channels['queue'] = list(channels.queue)
    # Retire the pose scheduler without calling stop(), which releases its legs.
    # Leave current pulses and channels.owning intact for move() to inherit.
    stock.mode = 'idle'
    stock.targets = {}
    stock.frames = []
    stock.frame = None
    if hasattr(stock, '_reset_pattern'):
        stock._reset_pattern()
        stock.last_input = None
    try:
        return begin()
    except Exception:
        # These successors validate/queue synchronously; actuator stepping has
        # not run between retirement and failure. Restore the previous owner.
        stock.__dict__.update(saved_stock)
        channels.__dict__.update(saved_channels)
        raise
