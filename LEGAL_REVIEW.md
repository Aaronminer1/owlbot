# Publication and provenance review

Review date: 2026-08-13

This is an engineering compliance record, not a legal opinion. It documents what is and is not intentionally included in the public community repository.

## Publication decision

OwlBot is distributed for noncommercial purposes under PolyForm Noncommercial 1.0.0. This matches the governing terms of the upstream GrowBot software and avoids claiming broader rights for adapted or interoperable portions. Commercial use is not granted.

## Provenance reviewed

- All tracked files and all reachable Git objects were inventoried.
- The OwlBot source was compared with the public GrowBot source at commit `48c592ac6393341aefbcea363b7614c14426d150`. No unexplained verbatim long-form matches were found by the line-based comparison. OwlBot nevertheless treats its GrowBot-inspired and protocol-compatible work conservatively as subject to GrowBot's noncommercial terms. The exact upstream license from that commit is preserved in `LICENSES/GrowBot-PolyForm-Noncommercial-1.0.0.txt`.
- The prototype body is the smaller `CAD/dog02_9g.stp` variant from James Bruton's YouCanBuildDog project. No CAD or upstream body source is included here. Its MIT notice is preserved in `LICENSES/YouCanBuildDog-MIT.txt` for attribution.
- The repository contains no GrowBot firmware, policy weights, CAD, artwork, website assets, or trained checkpoints.
- The 5.6-community update was merged against the audited 4.1 community tree rather than copied wholesale from the private phone build. The local-model runtime, automatic model downloader, unofficial Microsoft Edge Read Aloud transport, and their implementation files remain excluded. Continuous conversation relies on Android's system speech service and adds no vendored runtime dependency.

## Deliberately excluded

- API keys, Wi-Fi credentials, pairing codes, tokens, signing keys, device identifiers, conversations, face descriptors, precise locations, and phone backups.
- APKs and downloaded model weights.
- The unofficial Microsoft Edge Read Aloud transport and its client-identification constants. The community build uses Android's configured TTS engine.
- The automatic Gemma model downloader and LiteRT-LM runtime. Model weights have separate terms and must not be redistributed as part of OwlBot without a separate review.

## Third-party runtime components

- Google ML Kit face detection is obtained from Google's Maven repository during the build and is governed by the ML Kit and Google API terms. It is not stored in this Git repository.
- Android Gradle tooling and transitive Android/Kotlin libraries are resolved from their upstream repositories during the build and retain their own terms.
- The laptop bridge depends on `pyserial` and `websockets`, installed by each user from PyPI; neither package is vendored.
- Ollama, compatible model providers, weather/search/news sources, Android speech recognition, app intents, and the GrowBot relay are external services. Users are responsible for their accounts, keys, and applicable service terms.

## Branding boundary

The Android namespace and application ID use `dev.owlbot.brain`; the app theme is `Theme.OwlBot`. References to GrowBot identify inspiration, upstream origin, or protocol/relay compatibility. This repository is not official, sponsored, or endorsed by GrowBot.

OpenAI and Codex are named only to disclose substantial AI-assisted development. No OpenAI branding or assets are included, and the project does not claim affiliation, sponsorship, independent verification, or endorsement by OpenAI.

## Remaining operational obligations

Maintainers must run the secret scan and clean build before releases, preserve `LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, and `DEPENDENCIES.md`, review new dependencies and media before merging, and never attach an APK containing a downloaded model or credential. Any future commercial distribution requires written permission from every rights holder whose noncommercial material remains in the product.
