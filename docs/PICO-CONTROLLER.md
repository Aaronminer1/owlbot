# Pico 7.14: review and field evidence

This source release newly includes [the Pico firmware](../firmware/pico/README.md).
Earlier release notes saying firmware was excluded describe those earlier trees.
Android **7.23-community** and Pico **7.14** are separate version sequences.
Publishing this code does not update or wake any attached robot.

## Changes worth reviewing

- Original GrowBot walking poses are interpreted locally into a taught
  diagonal-leg/slide sequence. Feet lift before the first slide stroke.
- Walking lift is 60% of saved leg travel; static all-leg folding stays at 50%.
  These percentages are not safe universal pulse widths.
- Optional head holding survives ordinary movement cleanup. Explicit release
  remains authoritative. Pan/tilt stay slow (150 microseconds/second maximum),
  including recentering; movement speed does not speed up the head.
- Exact saved gestures support left/right turns and left/right/up/down/center
  head actions. Explicit `routine.name` values `spin_left`, `spin_right`,
  `turn_left`, `turn_right` (or space-separated) run one bounded calibrated
  turn and return Closed. An unlabelled stock neural-policy stream is different.
- Network pings run every ten seconds even under continuous incoming traffic.
  Application heartbeats every five seconds use a null request ID so they
  cannot acknowledge a motion request. Sent traffic never renews receive health.
- A new session sends a ping immediately and requires inbound traffic within
  ten seconds. Established sessions retain the 25-second receive deadline.
  A receive timeout cancels movement before radio recovery; no motion replays
  on reconnect. Backoff, bounded operations and the watchdog remain.
- Four RAM-only fault records retain the first failure even when later TCP
  retries fail differently. Diagnostics distinguish connection stage and I/O
  operation, count radio resets, and record close codes without reason text.

## What was actually tested

Host tests exercise parsing, partial writes, deadlines, cadence, recovery order,
saved gestures, head support, calibration, gait/turn scheduling and cancellation.
They do not simulate every radio, network or electrical failure.

Before publication, the installed 7.14 build completed a bounded power-OFF
controller test: 1,000 original-policy pose samples across three walking runs,
three explicit turn-alias runs, and quiet heartbeat checks. No disconnects were
observed during almost five minutes after connection; the controller reported
one session and zero failures/radio resets. ACKs and commanded cycle counts are
not physical travel measurements.

The owner subsequently reported a successful **powered floor test**: GrowBot
walked and explored until the phone battery depleted, with no connection
failure reported. That is human-observed evidence, not an instrumented endurance
benchmark: elapsed duration, path length and detailed logs were not recorded here.
Do not infer autonomous navigation reliability or guaranteed future uptime.

Low-phone-battery warning/graceful shutdown is a follow-up, not a new feature
implemented by this publication. Check the charge before supervised operation.

## Protocol boundaries

The phone owns perception and goal selection; the Pico owns calibrated timing.
Connection heartbeats, motion keepalives and fresh visual permission are distinct.
The firmware does not see camera images or know that a doorway was reached.
Review `_handle` and `serve` in main.py, then `StockCommands.start`,
`NamedGait`, `NamedTurn` and `PicoHead`. Stop can cancel queued work;
an explicit release may remove supporting torque.

See the firmware README for security limitations, missing private calibration,
saved-gesture setup and board-specific commissioning.
