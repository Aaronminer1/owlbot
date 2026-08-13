# Security policy

## Experimental status

OwlBot is a work-in-progress robotics experiment, not a hardened product. Do not deploy it where compromise, incorrect output, or unexpected physical motion could harm people, animals, property, accounts, or private data.

## Reporting a vulnerability

Use GitHub’s private vulnerability reporting/security-advisory interface for this repository when available. Do not open a public issue containing:

- API keys, tokens, passwords, Wi-Fi credentials, or pairing codes;
- private locations or device identifiers;
- conversations, face templates, camera images, or logs with personal data;
- a live body endpoint or exploit instructions that could move someone else’s robot.

Include affected version/commit, device and Android version, reproduction steps using redacted values, impact, and a proposed mitigation if known.

## Credential rule

No shared Ollama key exists for this project. Every user supplies their own key. Contributors must run:

```powershell
pwsh scripts/check-secrets.ps1
```

before committing. If a secret reaches any commit, revoke it immediately before attempting history cleanup.

## Known prototype risks

- Stock pairing-code relay mode is compatibility-oriented, not strong mutual authentication.
- The bundled page uses WebView universal file-origin network access to reach LAN HTTP/WS services.
- Cleartext LAN traffic can be observed or modified by devices on the same untrusted network.
- Model output, internet results, and Android intents cross trust boundaries.
- Physical motion depends on network, app, firmware, power, calibration, mechanics, and model/tool behavior.
- Release signing and distribution infrastructure are intentionally not included.

Security changes should preserve STOP/dead-man behavior, rest privacy, encrypted secret storage, recognition opt-out, explicit email review, and the rule that model output never directly installs or rewrites executable code.
