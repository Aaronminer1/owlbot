# Dependency and service inventory

Review date: 2026-08-13

Only direct build/runtime dependencies are listed here. Transitive libraries are resolved by Gradle or pip and retain their upstream terms. No third-party model weights are committed or packaged by this repository.

| Component | Version/range | How obtained | Governing source/terms |
|---|---:|---|---|
| Android Gradle Plugin | 8.5.2 | Gradle plugin repositories | Android SDK and tool licenses presented by Google |
| Gradle Wrapper | 8.7 | Tracked wrapper JAR and upstream download | Apache License 2.0; the JAR contains `META-INF/LICENSE` |
| Google ML Kit face detection | 16.1.7 | Google Maven at build time | [ML Kit Terms of Service](https://developers.google.com/ml-kit/terms) and incorporated Google API terms |
| pyserial | `>=3.5,<4` | PyPI, user-installed for laptop bridge | BSD license; [upstream project](https://github.com/pyserial/pyserial) |
| websockets | `>=16,<17` | PyPI, user-installed for laptop bridge | BSD-3-Clause; [upstream project](https://github.com/python-websockets/websockets) |
| GitHub Actions checkout/setup-java | pinned major versions in workflow | GitHub Actions service | Used only for CI; not shipped in OwlBot |

External endpoints—including Ollama/compatible model providers, Open-Meteo, search/news providers, Android speech services, and the GrowBot relay—are integrations rather than vendored dependencies. Their availability and terms are controlled by their operators. Users supply their own credentials where required.

Before adding a dependency, service, media asset, model, or generated artifact, document its exact version/source, license or terms URL, whether it is redistributed, and any required notices. Noncommercial compatibility with OwlBot's root license is required.
