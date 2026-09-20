# 7.15-community update

This source-only update brings the reusable 7.13–7.15 changes into the community
app (`dev.owlbot.brain`, versionCode 168). It does not migrate or update a private
development app with a different package ID. No live-agent settings, voices,
memories or device data are shipped.

## Included changes

- Walking speaks a short lifecycle result instead of reading controller JSON.
  An accepted request is not described as completed motion.
- Temporary path blockage/uncertainty retains the session's destination and
  obtains fresh evidence with backoff. A visibly clear, small alternative turn
  can be tried within a bounded recovery budget; fresh forward clearance is
  still required afterward.
- Slow, unavailable or malformed vision is distinguished from a visible
  obstacle. Broken model service retries are bounded, not an endless refusal.
- Navigation honors the selected vision route instead of silently preferring
  an installed local model. The public edition still excludes that private
  runtime and uses its configured compatible server/provider.
- A walking session owns its direction-facing camera through recovery and
  turns. Opposite-camera requests are refused until locomotion stops. Pending
  camera acquisitions recheck ownership, and stale cross-camera model reports
  are rejected. The saved physical camera mounting determines front/back use.
- Owner-disabled motors suppress automatic body-repair attempts; explicit
  manual connection remains available. Stop/cancellation remains authoritative.
- Publication review found and corrected a misplaced cancellation call: changing
  microphone mode no longer cancels travel. Actual motor-off cancels the session
  immediately before stop/release commands; a regression test covers both paths.
- Inline module contracts and a [review guide](REVIEW-GUIDE.md) explain the
  execution paths, concurrency, evidence limits and remaining concerns.
- The secret guard now scans staged content as well as working files. Tests
  verify staged-only leak detection and ensure values never appear in output.

## Publication boundary

The community build retains Android device TTS. Private neural-voice transport,
on-phone model runtime/downloader, embedding backend/weights and body firmware
remain excluded. Enrollment controls stay disabled without the required native
face engine. Tests use synthetic fixtures, not private servo calibration files.

## Verification scope

Source parsing, 45 regression suites, laptop-bridge dry-run tests and a clean
Android debug build are checked for publication. Credential review covers the
candidate files, staged content and available Git history; scanners cannot prove
the absence of every possible secret.

These tests do not establish physical travel, balance, obstacle avoidance or
real-world arrival. Named continuous walking requires compatible controller
firmware and supervised calibration; that firmware is not shipped here.
The publication build is not installed onto any private robot as part of this
update. See the review guide for known implementation limitations.
