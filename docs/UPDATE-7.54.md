# September 29, 2026 — OwlBot 7.54-community / Pico 7.16-sonar1

This is the latest public source update after [7.23-community](UPDATE-7.23.md).
Android remains `dev.owlbot.brain`, versionCode **207**. Controller firmware has
its own version sequence. Publishing does not install an app or flash a robot.

## What changed

- Exploration now distinguishes looking/thinking from an actual locomotion
  attempt. Active tasks retain their target, encourage an approach or replan
  after repeated stationary turns, and use a shorter follow-through cadence.
  It does not invent progress, force motor permission, or bypass provider,
  stale-camera, thermal or explicit-stop conditions.
- Continuous walking previews hand off at the current stride boundary instead
  of waiting on an obsolete boundary. Stop/pause cancels in-flight model-owned
  walking and turning, including late tool results and route-recovery callbacks.
- An explicit feet-still request persists independently of head control. Gaze,
  reading and conversation remain possible; resumption does not replay old motion.
- Camera and ultrasonic evidence can be associated only when timing, view,
  head pose and target evidence agree. Head-relative and body-forward directions
  are distinct. Level/forward viewing uses saved center calibration; a sideways
  look is not clearance to walk straight ahead.
- Optional range calibration preserves raw data and does not extrapolate its
  correction beyond the measured span. Gait-distance samples are scoped to
  speed, gait and surface. Neither cycle counts nor acknowledgements prove travel.
- Forward/reverse walking, calibrated bowing, independent head centering,
  face-attention handoff and channel-center editing are available through the
  appropriate commissioned controller tools.
- Completed investigations retain their answers without unsolicited repeated
  questioning. Identity state updates are quiet by default; recognizing a face
  is separate from identifying the object hit by a range beam.
- Shorter ordinary replies keep motion logistics internal. Story narration and
  requested detail remain exceptions. Speech capture/delivery and conversation
  continuity have bounded queues, cancellation and completion bookkeeping.
- Forty-eight cartoon expressions, optional costumes, music/humming states and
  context-selected story-scene expressions expand the face. Expiry and ownership
  prevent routine walking motion from monopolizing the surprised expression.

## Recent development chronology

| Version | Focus |
|---|---|
| 7.51 | Completed inquiries, retained answers and quiet identity updates |
| 7.52 | Moving-camera preview handoff and smoother stride continuation |
| 7.53 | Explicit feet-still hold and action/evidence provenance |
| 7.54 | Exploration momentum, retained target and cancellation of late actions |

These are development milestones, not independent public APK releases. The
public update includes the intervening source changes since 7.23.

## Controller and configuration

Pico 7.16-sonar1 adds the current bow/handoff/ultrasonic modules and incorporates
gait-start, reverse-motion, paced head and transport improvements. The head cap
is 400 microseconds/second, independent of body gait speed. Review the
[firmware setup guide](../firmware/pico/README.md) before installation.
Saved servo limits, center, gait, sensor calibration and network configuration
must be created for each body; no live robot configuration is published.

## Public edition boundaries, including Gemma

The public app is not the private development APK. On-phone Gemma weights,
its private runtime/downloader, private face-embedding backend, offline speech
runtime and unofficial neural-voice transport are **not included**. The public
selector therefore does not offer an unavailable on-phone Gemma brain.
Gemma served by a user-configured compatible Tower/Ollama endpoint is a separate
route; discovery depends on models that endpoint actually exposes.

The community app uses Android device TTS. Android 13+ system PCM speech and
the optional user-configured transcription route remain available; the private
older-phone offline recognizer is not part of this release. Generic face
detection is not the excluded enrolled-identity embedding backend.

No credentials, pairing IDs, Tailscale state, live memories, face profiles,
private logs, device IDs, downloaded models, APKs or signing keys are included.
The companion character remains owner-configured, without a personal identity
migration. Brit-specific reports remain outside this repository.

## Validation and known limits

Public source parsing and boundary checks, **80 JavaScript suites**, **378 Python
test executions** (including inherited fixture cases), the no-serial laptop
bridge smoke test, and an Android debug build passed. Canvas render checks use
a pinned development-only npm dependency. These tests do not establish physical
navigation reliability. The public APK was not installed on a phone in this
publication task.

The private development app's owner confirmed a preceding head-only look/center
and smooth forward walk. The latest 7.54 trial started a controller-reported
approach in about 3.8 seconds and reported four cycles; physical progress for
that particular run was not independently confirmed. Its first stop reported
a walking reassessment interval. Android moderate thermal status subsequently
disabled the camera and prevented continued visual exploration. That thermal
limitation is unresolved; it is not evidence that heat caused the initial stop.

No reliable autonomous arrival, full-room mapping, unattended operation or
complete controller-drop fix is claimed. Current-tree, staged-content and
available-history secret scans are performed before publication; no scanner can
guarantee that every possible secret has been detected.
