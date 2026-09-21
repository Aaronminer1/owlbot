# 7.23-community / Pico 7.14 source update

The app remains `dev.owlbot.brain`, now versionCode 176. Pico firmware has its
own 7.14 version sequence. Publishing does not install an APK or flash hardware.

## App changes since 7.15-community

- Complete attributed Für Elise with written repeats, piano and synthesized
  humming; bounded local hum capture; composition, variation and saved songbook.
  Playback/tool state gates claims of performance and avoids silent promise loops.
- Twelve complete child-to-child retellings plus historical editions, with
  source metadata and content notes. Tagged device-TTS completion preserves
  reading position. Talk-button/typed questions pause, use a bounded current
  scene without future passages, and wait for permission to resume.
- Context-driven speech pitch/rate, keeping the selected voice identity.
- Timestamped sensor acquisition and nonvisual interpretation. Stale/missing
  data does not establish an obstacle, clear path, physical travel or arrival.
- Refresh slow initial walking vision before starting, and report a stopped
  Pico run's actual terminal cause instead of claiming the walking tool vanished.
- Preserve reviewer comments and public-edition guards. The walking UI does
  not offer the excluded on-phone runtime. Android device TTS retains the
  narration-completion callback; private neural transport is not included.

## Controller source

This release newly includes [Pico source and commissioning notes](../firmware/pico/README.md).
See [the controller review](PICO-CONTROLLER.md) for stock GrowBot compatibility,
turn aliases, head holding, startup foot lift, heartbeat/recovery changes and the
owner-reported powered exploration result. No website code is changed.

## Publication boundaries

No keys, Wi-Fi credentials, pairing IDs, device IDs, live-agent identity/memories,
face templates, saved servo calibration, logs/backups, model weights, private
runtime/downloader, embedding backend, neural-voice transport, APK or signing
material is included. Firmware defaults are not a replacement for commissioning.
Generic identity stays owner-configured; no Andrew-specific migration is exported.
Media attribution and source notices accompany the new library/score.

## Verification

Source parsing, community-boundary checks, 56 JavaScript suites, 287 host Python
test executions (including inherited fixture cases), laptop-bridge dry-run and
a clean Android debug build were run. Host tests never connect to a robot.
Candidate-tree, staged-content and available-history secret scans are required
before publication; scanners cannot prove absence of every secret.

The new community APK was not installed on a phone. The powered GrowBot field
test concerns the installed controller, not this public Android package.
No endurance duration, reliable depth sensing or battery shutdown improvement
is claimed.
