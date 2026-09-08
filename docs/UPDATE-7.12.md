# 7.12-community update

This public snapshot shares reusable improvements from development while preserving the community edition's publication boundaries. It is not the private development APK and has a separate application ID (`dev.owlbot.brain`). Installing it does not update or migrate an app using another package ID.

## Included

- Provider selection and model discovery for Ollama Cloud, a local Ollama server, an owner-configured Tower, and compatible endpoints. Local-only routes do not send cloud keys, filter cloud-backed model identifiers, and reject stale discovery results after a provider change.
- Bounded model context with complete tool-call/result groups, local conversation archiving, relevant retrieval, and remembered-answer continuity.
- Identity upgrades preserve each individual's saved name, age-like persona and continuity. No one owner's personality change is applied to other installations.
- A self-improvement switch, off by default, independent of normal conversation and memory. Better initiative scheduling and microphone capture lifecycle handling.
- Named-channel binding checks, separate owner/runtime motor controls, variable walk cycles, continuous walking sessions, camera-evidence freshness checks, bounded course correction and slow head movement.
- Context-driven expressions and a consent-first, silent-identification interface. A separately reviewed native face backend is required for recognition/enrollment; no face model weights are included here.
- Deterministic regression tests and CI checks. Fixtures are synthetic, including servo topology and identity vectors. Tests do not connect to a phone, model server or robot.

## Kept out

Credentials, pairing values, network configuration, private device identifiers, conversations, face templates, photographs from device testing, diagnostic logs, backups, APKs, signing keys and model weights are not part of this update. The private Gemma runtime/downloader, its on-phone brain provider, unofficial neural-voice transport, new face-model backend and body firmware remain outside this public snapshot. The community build uses Android device TTS and selected-provider model inference.

## Validation and limits

The bundled JavaScript parses; all 41 source regression suites pass. A clean Android debug build is part of publication verification and CI. Credential scans cover the candidate tree and Git history; no scanner is a mathematical guarantee against every possible secret, so an explicit source-only file inventory is also reviewed.

This community APK is not installed onto private agents as part of publication. These checks do not prove physical travel, obstacle avoidance, privacy under every failure mode, or third-party model quality. Continuous walking requires compatible controller firmware and current supervised calibration; acknowledgements are not evidence of real-world arrival.
