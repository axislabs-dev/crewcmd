# Realtime Voice OpenClaw Passthrough PoC

## Goal

CrewCMD's current voice path captures speech, waits for a final recording, transcribes it, sends text to chat, then synthesizes speech from text deltas. OpenClaw 2026.5.18 has a lower-latency realtime talk stack that keeps a live audio session open and streams microphone audio, model audio, transcripts, interruptions, and tool events.

This PoC keeps the reliable legacy path intact and adds a narrow passthrough path so CrewCMD can ask an OpenClaw runtime for a realtime talk session.

## Preferred Architecture

1. CrewCMD server connects to the selected OpenClaw runtime using the existing gateway pool.
2. CrewCMD requests `talk.realtime.session` through the gateway.
3. Browser clients use the returned transport:
   - `webrtc-sdp` for direct browser realtime sessions.
   - `json-pcm-websocket` for browser PCM websocket sessions.
   - `gateway-relay` when OpenClaw needs CrewCMD to relay PCM chunks and events.
4. CrewCMD maps transcript and lifecycle events back into the chat UI.
5. Existing `/api/stt`, `/api/tts`, and native recorded speech remain the fallback.

## PoC Scope

- Add typed gateway methods for `talk.realtime.*`.
- Add authenticated runtime routes for requesting realtime sessions and controlling gateway relay sessions.
- Add a small browser client helper that starts with direct realtime sessions and exposes the relay contract.
- Add capability metadata so the UI can explain whether realtime voice is merely possible or actually configured.
- Document the remaining native/mobile work separately from desktop web.

## Non-Goals

- Reimplement OpenAI or Google realtime provider protocols inside CrewCMD.
- Replace the current reliable voice recorder in this change.
- Solve iOS background realtime audio in the first pass.
- Persist every realtime transcript event into chat history before the transport is proven.

## Open Questions

- Whether the target OpenClaw runtime exposes direct browser sessions for the configured provider or only gateway relay.
- Whether CrewCMD should surface OpenClaw's `openclaw_agent_consult` tool verbatim or translate it into CrewCMD-native agent/team actions.
- Whether mobile should use foreground WebView realtime first or native PCM streaming first.
