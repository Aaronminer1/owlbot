# Experimental shared Pico body controller — 7.14

Start with [the controller review guide](../../docs/PICO-CONTROLLER.md).
This is OwlBot's adaptation of the GrowBot protocol/driver for a calibrated
slide-driven body, not official GrowBot firmware or a universal servo map.
It uses the repository's PolyForm Noncommercial license and retained upstream
notices. No model weights, MicroPython binaries or device configuration are bundled.

## Files and ownership

| Files | Responsibility |
|---|---|
| main.py / relay_chip.py | Identical entrypoints: Wi-Fi/TLS/WebSocket, dispatch, heartbeats, recovery |
| PicoRobotics.py | GPIO/PCA9685 output, calibration and retained head ports |
| servo_channels.py | Saved channel names/endpoints and paced output |
| named_gait.py / named_turn.py | Taught walking sequence and bounded turn with return Closed |
| pico_head.py / gimbal_engine.py | Slow head positioning and optional holding |
| shared_body.py | Versioned high-level command translation; no phone vision on the Pico |
| stock_body.py / stock_fanout.py | Original GrowBot L/R posture/alternating-support interpretation |
| stock_commands.py | Exact saved-gesture encoding and explicit turn/spin aliases |
| dog_engine.py | Legacy six-servo intent engine; default map is not the commissioned body map |

## Before installation

Disconnect servo power and pause the controlling app. Back up the Pico's current
files outside Git. Use MicroPython for **your exact wireless Pico board**; the
maintainer's test used Pico 2 W with MicroPython 1.28.0.

Copy the 13 Python modules in this directory to the Pico filesystem, choosing
`main.py` as the boot entrypoint. `relay_chip.py` is an identical source mirror,
not a second service to launch. Create a local `secrets.py` from the example.
Do not upload the entire repository or overwrite existing calibration blindly.
No installer in this publication connects to or drives a physical device.

Calibrate your actual board channels/endpoints with the body-control UI and
save a compatible named walking plan. Runtime files such as servo_channels.json,
named_walk.json, dog_cal.json, dog_gait.json and gaze_cal.json are intentionally absent.
The firmware's legacy defaults are NOT permission to power an uncalibrated body.
No boot sweep runs in this build, but explicit incoming commands can emit PWM.

For GrowBot's saved turn/head commands, copy the disabled example to a local
`stock_commands.json`, commission direction, head inversion, travel and
holding on your mechanism, then opt in. `pattern_a_direction` must be verified
physically as left or right. `turn_fraction` is calibrated linkage travel
(0.02–0.60), not heading degrees. A heavier head may need holding enabled;
holding consumes power and requires a suitable servo and supply.

The seven saved gestures use `stock_commands.frames(op)`, with op 1–7 matching
`NAMES`. Export their exact dictionaries into the robot's existing saved-gesture
configuration; do not improvise the framing numbers. No GrowBot website patch
is required. Existing arbitrary L/R spin-policy streams do not carry direction
names and are NOT automatically converted to turns.

## Host tests (no hardware)

From the repository root:

```text
python -m unittest discover -s tests -p "test_*.py"
```

These tests use fake clocks/boards and temporary calibration. Do NOT import
`main.py` on a connected MicroPython board as a test: its top level starts
the controller. No owner configuration, device IDs or recordings are fixtures.

## Security and electrical limits

The stock relay uses a short chip-derived pairing identifier, not an
owner-controlled strong authorization token. The current MicroPython TLS setup
uses SNI but does not explicitly configure certificate validation. Treat the
relay, network and paired clients as part of the trust boundary; do not expose
this experimental controller as a security-sensitive or unattended robot.
The saved-gesture checksum is framing, not authentication.

Servo power is separate from USB logic power. An ACK is a command response,
not proof of powered servos, measured travel, balance or obstacle clearance.
The driver's optional VSYS helper is not a servo-rail measurement and is not
used as verified battery telemetry here. Stop/release semantics and physical
power isolation must be tested on each installation.
