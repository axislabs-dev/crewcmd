---
title: Voice & Speech
description: Hands-free voice interaction with AI agents.
---

CrewCmd supports voice input and text-to-speech output for hands-free operation.

## Speech-to-Text (Input)

Uses the browser's native **Web Speech API** for voice recognition:
- Click the microphone button or use keyboard shortcut
- Speech is transcribed in real-time
- Transcription is sent as a chat message

No API key or configuration required — works in any modern browser.

## Text-to-Speech (Output)

Agent responses can be read aloud:

| Mode | Provider | Setup |
|------|----------|-------|
| **Default** | Browser `speechSynthesis` | Zero config — works immediately |
| **Premium** | OpenAI TTS | Requires OpenAI provider key |

The browser's built-in TTS is used by default. When an OpenAI provider key is configured, you can upgrade to higher-quality voice synthesis.

## API

```
POST /api/speech/tts    # Text-to-speech conversion
POST /api/speech/stt    # Speech-to-text conversion
```
