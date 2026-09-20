# Code review guide

This is a reading map for GrowBot contributors and other reviewers, including
Bret. It explains the current implementation, not an idealized design or a claim
that the robot is production-ready. Start with the changed navigation modules,
then follow the shared state and native boundaries below.

## Read in this order

1. [walk-stream.js](../app/src/main/assets/walk-stream.js): destination ownership,
   recovery, Stop and speech about outcomes.
2. [named-walk.js](../app/src/main/assets/named-walk.js): saved gait bindings,
   camera checks, continuous previews and controller protocol.
3. [drive-robot.js](../app/src/main/assets/drive-robot.js) and
   [head-controller.js](../app/src/main/assets/head-controller.js): calibrated
   turns, gaze routing and independent cancellation.
4. [growbot-brain.html](../app/src/main/assets/growbot-brain.html): search for
   `enableCamera`, `sendAcknowledgedBodyCommand`, `runTool`, `mindTick`,
   `motorControlAvailable` and `restNow`. This page still wires the shared system.
5. [MainActivity.java](../app/src/main/java/dev/owlbot/brain/MainActivity.java):
   native permissions, bridge, microphone/speech, sensors and credential storage.
6. [tests](../tests): executable, synthetic examples of expected failure behavior.

Companion scripts are classic scripts sharing globals, **not isolated ES modules**.
Some load before the main inline script and defer access to its state until their
functions run; UI-wiring modules load afterward. Preserve script order. Moving a
top-level initializer across that boundary can cause a temporal-dead-zone failure.

## Ownership and module map

All JavaScript modules below are under `app/src/main/assets/`.

| Component / primary state | Owns | Does not prove or own |
| --- | --- | --- |
| `growbot-brain.html`: `APP`, `S`, `MIND`, `MEM` | UI/lifecycle, foreground model/tool loop, main body socket, persistent records | A model sentence is not a completed physical action |
| `walk-stream.js`: `WALK_STREAM.session` | One destination, recovery phases, steering orchestration, cancellation | Servo trajectories, measured position or arrival |
| `named-walk.js`: `NW` | Saved routine, binding checks, direction camera, gait/preview protocol | Changing owner calibration to fit an inferred wiring layout |
| `drive-robot.js`: `DRIVE_ROBOT` | Manual controls and calibrated turn primitive | A turn fraction is not a measured angle |
| `head-controller.js`: `HEAD` | Slow semantic pan/tilt, Pico or separate ESP32 routing | Body speed must not become head speed |
| `travel-estimate.js` | Owner-measured samples keyed by gait/speed/direction/surface | Camera depth, live localization or motor permission |
| `executive-context.js` | Current situation, relevant tools and bounded context assembly | Loading a tool does not grant permission to run it |
| `context-window.js`: `OwlContext` | Pure request budgeting/retrieval helpers, complete tool exchanges | Estimates are not the provider's exact token count |
| `context-memory.js`: `CONTEXT_MEMORY` | IndexedDB archive, selected recall, attributed action episodes | A recalled reply is not verified current evidence |
| `interaction-lane.js` | Human-input priority, delivery/retry bookkeeping | Retrying an action after side effects is forbidden |
| `inquiry-progress.js`: `INQUIRY` | Recent report IDs, exact evidence excerpts, stalled curiosity | Repeated views or accepted PWM are not discoveries |
| `question-continuity.js`: `OwlQuestions` | Narrow subject/intent matching for answered questions | Not universal semantic matching or independent visual verification |
| `self-improvement.js`: `SELF_IMPROVEMENT` | Owner-controlled, default-off reflection jobs | Disabling reflection does not disable memory or exploration |
| `social-initiative.js`: `SOCIAL_INITIATIVE` | Quiet-time speech through the existing scheduler | No separate model loop, camera or motion action |
| `face-identity.js`: `IDENT` | Consent, profile validation and silent matching interface | Community edition does not include its embedding backend |

`SOUL.md` is the generic character foundation, not an export of a particular
agent's life or personality settings. Each installation retains its own identity.

## Trace a forward walk

```text
human intent / allowed model tool
  -> startWalkingStream: one destination and cancellation guard
    -> runNamedForwardWalk: verify controller capability + saved bindings
      -> checkNamedWalkPath: align head slowly, select travel-facing camera
        -> capture a new frame -> infer clearance -> validate structured result
      -> walk_run / walk_preview / keepalive through acknowledged command lane
    -> keep moving, request a small course correction, or enter bounded recovery
  -> report an evidence-limited outcome; never infer arrival from cycle count
```

Normal gait timing lives on the controller. `createWalkPreviewWorker` permits one
in-flight view and at most one forthcoming cycle approval; it can process vision
while the legs move. Keepalive maintains the link, while a fresh preview grants
the next cycle. They are not interchangeable. Slow inference can still make the
controller wait with its feet down; this is not a hard-real-time vision system.

The normal preview freshness window is 2,500 ms. Inference time consumes that
budget. Reusing an old clear answer is not a way to improve throughput.

### What happens when progress fails?

| Condition | Current behavior |
| --- | --- |
| Visible blockage / uncertain floor | Keep destination, wait with backoff, obtain new evidence |
| Repeated forward blockage | If a fresh view shows floor and swept space for a small alternative turn, try it; then require a fresh one-cycle forward approach |
| Malformed, slow or unavailable vision | Treat as service failure, not an invented obstacle; terminate after four failed runs total |
| Heading drift | Recheck direction, use small calibrated turn fractions, resume the same session with fresh clearance |
| Stop, Rest, motor authority change or connection change | Invalidate/abort work; do not resume solely because the connection returns |
| Halt not confirmed | Do not start a recovery movement based on an assumed stop |

Recovery delays grow from 1 second to at most 15 seconds. The session's default
reassessment deadline is 300 seconds (caller range 10–600). Checked detours use
0.08 of a taught turn and allow at most two without controller-reported cycle
progress; drift corrections may increase from 0.08 to 0.12 to 0.16. These limits
are software budgets, not measurements of clearance, balance, yaw or travel.

`goalRetained` means the destination remains in status; it does **not** mean a
completed/canceled session silently restarts later. `physicalArrivalVerified`
remains false. The next physical trial still needs a supervising person.

## Camera ownership and race conditions

The default forward mapping is selfie/front, but the owner can explicitly choose
a different physical mount. Backward travel uses the opposite sensor.
`navigationCameraFacing` retains that choice through recovery and turn cleanup.

Every UI/tool/perception switch goes through `enableCamera`. It rejects an
opposite-direction request during navigation, checks the actual track's
`facingMode`, and checks ownership again after asynchronous acquisition/playback.
This prevents a rear request queued earlier from stealing a newly started walk.
An opposite-camera tool refusal does not claim that a new view was obtained.

After Stop cleanup, rear inspection is allowed again. The primary-camera return
timer waits for active vision/navigation rather than changing their sensor.
Reports that finish across a camera generation/facing change are discarded;
cached evidence from the other camera is not returned as current-view evidence.
Head pose has its own generation check because panning can change the corridor
without changing the phone sensor.

Tests: `test_navigation_camera.cjs`, `test_primary_camera.cjs`,
`test_course_vision_stages.cjs`, `test_moving_vision.cjs`,
`test_walk_vision_contract.cjs`.

## Commands, cancellation and truthful speech

- The owner grants standing motor authority (`MIND.motionArmed`); the agent has
  a separate runtime switch. The runtime switch cannot override the owner.
  Manual supported-test controls are a distinct path and require separate review.
- `sendAcknowledgedBodyCommand` registers its waiter **before** sending. Stop
  invalidates queued generations and bypasses the normal promise tail, so an old
  queued movement cannot run after it. Head routing is resolved before entering
  that lane to avoid a command waiting behind itself.
- A callback must check its generation/session guard after an await. An abort
  signal alone is insufficient if a provider returns despite cancellation.
- A successful ACK means the controller accepted/reported the protocol action.
  It does not prove servo-rail power, balance, traction or physical displacement.
- `walkingStreamSpeech` translates lifecycle state to plain speech. The initial
  response means “checking,” not “walked”; raw controller JSON stays diagnostic.
- `interaction-lane.js` can retry a retained human message before side effects.
  Once a tool has acted, it reports interruption rather than replaying the action.

Tests: `test_body_command_lane.cjs`, `test_navigation_recovery.cjs`,
`test_course_recovery.cjs`, `test_direct_walk_speech.cjs`,
`test_interaction_lane.cjs`, `test_body_recovery.cjs`.

## Privacy and native trust boundaries

The Android bridge permits the exact bundled page to access native capabilities.
Credential values are entered on-device; allowed secret slots are encrypted with
AES-GCM using an Android Keystore key. Source code contains slot names, not keys.
The page can request plaintext for configured network calls, so encrypted storage
does not defend against a compromised running page. LAN HTTP/WebSocket and
permissive file-origin network access remain prototype compatibility choices.

Model output, image text and web results are untrusted inputs. Relevant memories
and camera frames may go to the selected model service; local storage does not
mean every feature is offline. Read [PRIVACY.md](PRIVACY.md).

The public edition excludes private model runtimes/downloaders, model weights,
neural-voice transport, face embeddings backend and body firmware. It uses Android
device TTS. Face enrollment is visibly unavailable without the embedding backend;
forgetting saved profiles remains possible. Do not “fix” that by copying private
assets or enabling a nonfunctional enrollment button.

Optional tools: `tools/mind-proxy.mjs` reads runtime environment credentials and
requires a client token for non-loopback listening. The laptop Maestro bridge
defaults to dry-run and uses synthetic example calibration; neither is the
unpublished named-gait Pico firmware.

## Publication and secret review

1. Review an explicit source-only diff. Exclude live-agent exports, logs, images
   from testing, calibration, IP/device configuration, APKs, model weights and keys.
2. Run `pwsh scripts/check-secrets.ps1` **after staging**. It scans working and
   index contents and rejects forbidden tracked artifacts. It prints rules/paths,
   never matched credential values.
3. Use a dedicated scanner on an export of the exact candidate index/tree and
   on all available history, for example Gitleaks 8.30.1 with full redaction:

   ```text
   gitleaks dir PATH_TO_CLEAN_CANDIDATE --redact=100
   gitleaks git . --log-opts=--all --redact=100
   ```

4. Run parsing, regression and build checks from [README.md](../README.md).
5. Review the staged file inventory again before pushing. Keep raw scanner
   reports outside the repository; even a finding report can contain secrets.

The scanners do not guarantee absence of every secret or sensitive fact. If a
real credential was committed historically, removing its current line is not
enough: stop publication, revoke/rotate it, and coordinate any history rewrite.
Do not force-push an unreviewed history cleanup.

## Known limits worth reviewing next

- The main page remains a large shared-state monolith. This update adds reading
  aids, not a structural rewrite or proof that every interleaving is safe.
- `memLoad` calls legacy `repairRitualSharedMemory`, which recreates matching
  ritual entries using the current person and appends them. That can change
  original attribution/order. It is documented, not fixed in this publication;
  an attribution-preserving migration needs dedicated upgrade fixtures.
- Vision gives qualitative evidence, not depth sensing or reliable localization.
  False blockage, late inference, incorrect classifications and mechanical slip
  remain possible. Camera ownership prevents a wrong-view race, not every
  navigation failure.
- Context budgeting uses a conservative estimate; the selected provider/model
  still determines actual supported limits and token accounting.
- Passing mocks does not validate physical gait, private backend integrations,
  Android behavior on every phone, service retention, or real-world safety.
  This public snapshot is not an end-to-end release of the named-walk firmware.
