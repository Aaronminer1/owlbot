# Privacy and data handling

OwlBot combines phone sensors, conversation, memory, internet tools, and optional physical movement. This document explains the source snapshot’s intended behavior; it is not a third-party audit or legal policy.

## Stored locally

- Selected provider, model, voice, body address, pairing code, calibration, and capability settings.
- Conversations, people/notes, facts, lessons, episodes, goals, tasks, affect, growth, autonomy, and self-model state.
- Optional facial-recognition descriptors and names.
- API key and hardened body token encrypted through Android Keystore-backed AES-GCM storage.

Android backup is disabled in the manifest. Clearing app data removes the app’s local state; the UI also exposes targeted memory and face deletion controls. Verify deletion behavior on your Android version before relying on it.

## Information that may leave the phone

| Feature | Recipient | Potential data |
|---|---|---|
| Cloud mind | User-selected Ollama/compatible endpoint | Released transcript, prompt, relevant memories, sensor summary, tool results, and current camera frame when cloud vision is enabled |
| Android TTS | Speech engine selected in Android settings | Text selected for speech; provider behavior depends on the installed engine |
| Android speech recognition | Device/vendor recognition service | Audio from the active push-to-talk session |
| Weather | Open-Meteo | Latitude/longitude and forecast parameters |
| Web research | Brave, Bing, DuckDuckGo, Wikipedia | Text search query, network metadata |
| News | Google News RSS | Text topic query, network metadata |
| GrowBot body relay | Original GrowBot relay service | Pairing identifier, presence/status, movement commands, acknowledgements |
| Phone app actions | Selected installed app | Intent data such as search terms, Pandora query, or email draft fields |

Do not enter secrets or private information into search queries. Weather necessarily reveals a location to the weather provider. Email drafting can expose draft contents to the selected email application after the intent opens.

## Camera and facial recognition

- Generic person-presence and face-location processing can run without identifying a person.
- Facial recognition defaults off.
- While recognition is off, OwlBot does not build descriptors, compare stored templates, request a name for recognition, or enroll faces.
- Turning recognition off preserves existing templates in a dormant state; use Forget all faces to delete them.
- Face templates are intended to remain local and are not attached to model or search requests.
- Cloud vision can send a current camera frame to the selected mind provider. Use phone-local vision or disable Vision to avoid that path.

## Microphone and rest

Conversation hearing is push-to-talk. OwlBot should stop capture after release and should not continuously restart recognition. Rest mode stops model activity, cancels internet work, disables camera and microphone use, and stops body motion until touch wakes the app.

## Credentials

The repository contains no API keys. Users provide their own key in the app. Source code only contains endpoint URLs, empty fields, placeholders, environment-variable names, and encryption logic.

Never paste a real credential into GitHub. If exposed:

1. Revoke/rotate it at the provider immediately.
2. Remove it from the working tree.
3. Purge it from Git history using an appropriate history-rewrite tool.
4. Invalidate any cached or derived credential.
5. Review provider access logs and open a private security report.

## Permissions

The manifest requests internet/network state, Wi-Fi state, location, activity recognition, camera, microphone, wake lock, vibration, and installed-package visibility. Some are optional at runtime; `QUERY_ALL_PACKAGES` is broad and exists for experimental app discovery. A production design should replace it with narrower package queries or user-selected intents where possible.

## User responsibility

Review the source, provider terms, Android permission screen, and network destinations before use. Do not use OwlBot with people who have not agreed to camera/microphone processing. Do not store sensitive health, financial, legal, work, or identity data in this experimental app.
