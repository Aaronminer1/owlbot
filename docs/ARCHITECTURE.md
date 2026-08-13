# OwlBot architecture

This document describes the Android OwlBot 4.1 source snapshot. It is an implementation guide, not a safety or production-readiness claim.

## Runtime boundaries

### Native Android host

`MainActivity.java` owns Android capabilities that a local HTML page cannot reliably provide:

- runtime permissions;
- accelerometer, gravity, gyroscope, magnetic field, rotation, light, pressure, proximity, step, battery, and thermal readings;
- location fixes;
- camera capture and local face bounding boxes;
- push-to-talk Android speech recognition;
- neural/device speech playback;
- Android Keystore-backed secret encryption;
- installed-app search and explicit app intents;
- weather, web, and news retrieval;
- the bridge to optional local vision;
- lifecycle handling when the app backgrounds or stops.

The JavaScript bridge is exposed only to the app’s bundled `file:///android_asset/growbot-brain.html` page. The WebView permits network access from that page because the body may be available only over LAN `ws://` and model endpoints may use HTTP on a private network. This is useful for experimentation but is one of the reasons the app is not production-ready.

### OwlBot brain page

`growbot-brain.html` contains the face, state machines, memory, behavior, controls, model client, tool descriptions, tool executor, body transport, gait generator, calibration, and autonomy executive.

The face uses a deterministic context resolver around reasoned model appraisal. Thermal protection, Rest, falls/free-fall, critical battery, and active listening/thinking/speaking are immediate truths. A fresh model or verified-outcome appraisal then controls the face with its stored reason; lower-priority recovery, touch/play, locomotion, and task context fill in only when no fresher appraisal exists. Repeated automatic failure resolves to confused/focused, never angry. Anger requires an explicit current model appraisal with a concrete reason.

Major persistent surfaces include:

- preferences and selected providers;
- conversations, people, facts, notes, lessons, and episodes;
- identity/self-model state;
- needs, growth, affect, inner life, and goals;
- autonomy missions, candidates, history, and world observations;
- local face templates when recognition is enabled;
- body calibration and gait parameters.

API and hardened body keys are excluded from the HTML preference object and delegated to native encrypted storage.

### Mind provider

The page uses an OpenAI-compatible chat-completions/tool-calling shape. Ollama Cloud is the default provider option, but users can choose an accessible local Ollama endpoint or another compatible service. The repository does not supply credentials.

The tool loop adds an assistant tool-call message, executes bounded native/local functions, appends tool results, and asks the model for a final answer. Physical truth is still limited by available sensors: an acknowledgement proves that firmware accepted a command, not that the robot achieved the intended real-world outcome.

### Local vision

The public community build does not bundle a local-model runtime or automatically download model weights. Cloud vision uses the provider explicitly selected and configured by the user. A future local-model integration must present and honor the model's terms before download and must keep weights out of Git and release APKs.

### Body control

OwlBot supports three body modes:

1. **Stock GrowBot relay mode** — the user supplies the ESP32 pairing code. The phone sends the stock attach envelope, waits for body presence, and converts poses/gestures into the stock relay protocol. No separate control token is used.
2. **Experimental hardened mode** — a compatible controller may require a separate token and expose additional direct-LAN messages.
3. **Quad8 high-level mode** — the phone sends one authenticated, bounded walk, turn, look, rest, release, or stop intention. A laptop, ESP32, or Pico owns gait timing and the complete Maestro trajectory; the phone never streams eight joint targets.

The two-servo and dog6 paths retain their existing behavior. Quad8 commands are correlated by request ID and finish with a completed, stopped, or fault acknowledgement. Every controller must still enforce link-loss release because network or app failure can happen between phone-side checks.

## Important flows

### Conversation

1. The user presses and holds talk.
2. Android speech recognition captures only that session.
3. On release, OwlBot builds a current sensor/memory snapshot.
4. If configured, one current camera frame may be attached.
5. The selected mind provider returns text and/or tool calls.
6. Tool calls execute locally/native/online according to enabled capabilities.
7. A final answer is spoken and the completed exchange is summarized locally.

### Rest

1. The user presses Rest.
2. OwlBot stops model activity and cancels pending internet work.
3. Speech, MIDI, gait learning, and body motion stop.
4. Camera, microphone, location updates, and continuous hardware sensors are disabled.
5. The face remains on the same screen with closed eyes and sleep animation.
6. Touch wakes OwlBot and only then resumes configured capabilities.

### Thermal protection

1. Android battery/thermal state is sampled independently of model activity.
2. At moderate heat, OwlBot closes and locks out the camera, lowers face rendering cadence/resolution, slows JavaScript polling, and switches native sensors/GPS to low-power cadence.
3. At severe heat or above, OwlBot stops model work, speech capture, MIDI, body motion, local inference, camera, location, and continuous hardware sensors; the screen wake lock is released and the face changes to a distinct animated `COOLING DOWN` state.
4. Direct sensor snapshots continue at a slow cadence so Android can report cooling.
5. Automatic recovery requires the phone to remain at light-or-lower thermal status for 30 seconds. User Rest remains authoritative and is never cleared by thermal recovery.

### Stock body gesture

1. A control or model requests a named gesture.
2. OwlBot maps the name/alias to explicit bounded servo frames.
3. The relay sends an `act` message with a request ID.
4. The ESP32 returns an acknowledgement with queued duration.
5. OwlBot reports success only after acknowledgement; lack of acknowledgement becomes failure/uncertainty.

### Weather

1. The model calls the dedicated weather tool.
2. Android reads the latest permitted location fix.
3. Coordinates are sent to Open-Meteo.
4. The structured result is returned to the model with units/timestamps.

## Trust boundaries

- Model output is untrusted input to the tool executor.
- Search/news snippets are untrusted external text.
- Android intents can transfer control/data to another installed app.
- Relay presence is not proof of strong identity.
- A firmware acknowledgement is not proof of successful physical movement.
- Camera and motion estimates are noisy and mount-dependent.
- Any local HTTP/WS endpoint must be treated as a private-network prototype surface.

Before production use, separate the monolithic brain page, replace permissive WebView network access, define a versioned database and migration strategy, harden device authentication, add deterministic policy enforcement outside the model prompt, create automated behavioral and protocol tests, and complete external privacy/security review.
