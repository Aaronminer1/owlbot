# Contributing to OwlBot

OwlBot welcomes careful experiments and documentation, but physical robots and private phone data raise the cost of mistakes.

## Before starting

1. Read the README, architecture, privacy, and security documents.
2. Search existing issues.
3. Keep changes narrowly scoped and explain the real problem they solve.
4. Never include credentials, private logs, face data, precise location, device IDs, or someone else’s copyrighted firmware/assets.

## Development checks

```powershell
pwsh scripts/check-secrets.ps1
.\gradlew.bat clean assembleDebug
```

For changes to `growbot-brain.html`, also verify that every inline script parses and test the relevant state across app restart. Spoken output is not proof of persistence or physical action.

## Physical-motion changes

- Support the body off the ground for first tests.
- Start with small bounded angles and return to neutral.
- Preserve STOP, request acknowledgements, motion time limits, and firmware dead-man behavior.
- Report the servo supply separately from phone/ESP32 power.
- State which ESP32 firmware/protocol was tested.
- Do not claim travel or recovery succeeded solely because firmware acknowledged a command.

## Pull requests

Describe:

- what changed and why;
- relevant privacy/security/physical effects;
- exact validation performed;
- what remains untested;
- whether stored-state formats or permissions changed.

By submitting a contribution, you represent that you have the right to submit it and agree that it is distributed under this repository's PolyForm Noncommercial 1.0.0 terms. Do not add third-party code, models, media, or assets without documenting their exact source and compatible license or service terms in `DEPENDENCIES.md` and `THIRD_PARTY_NOTICES.md` as applicable.
