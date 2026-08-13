# Laptop Maestro bridge

This development-only service lets a Windows laptop temporarily replace the
ESP32 or Pico body controller:

`OwlBot phone -> authenticated local WebSocket -> laptop -> Maestro USB command port`

The phone sends only bounded intentions. The laptop owns gait timing,
interpolation, channel mapping, pulse limits, STOP handling, and link-loss
release. It starts in **dry-run mode**, which never opens the serial port.

## Install

```powershell
python -m pip install -r requirements.txt
$env:OWLBOT_BODY_TOKEN = '<a new random value of at least 16 characters>'
python bridge.py
```

Point OwlBot's direct body address to `ws://<laptop-ip>:8765/ws` and enter the
same runtime token in OwlBot's body-control token field. Do not commit it.

## Live output

Do not use the example calibration for real motion. First copy
`quad8.example.json` to a filename ending in `.local.json`, identify every
joint, and replace every channel, center, limit, travel, and inversion value.
Local calibration files are ignored by Git.

Only after the body is supported off the ground:

```powershell
python bridge.py --live --serial-port COM6 --config quad8.local.json
```

Closing the phone connection, stopping the process, sending STOP, or a command
fault releases all channels the service has touched. This is a software
failsafe, not a substitute for a reachable servo-power disconnect.

## Message examples

```json
{"t":"command","name":"walk","direction":"forward","steps":2,"speed":0.5,"rid":1}
{"t":"command","name":"turn","direction":"left","amount":30,"speed":0.5,"rid":2}
{"t":"command","name":"look_left","rid":3}
{"t":"command","name":"stop","rid":4}
```

The bridge returns an `ack` with `phase: completed`, `stopped`, or `fault`.
