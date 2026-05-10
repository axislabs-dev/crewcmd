# Native Background Agent Session Design

> Scope: CrewCMD mobile Agent Mode on iOS/Capacitor. This design covers keeping the microphone/audio session reliable when the app is backgrounded, the phone is locked, or the WebView is throttled.

## Problem

Current Agent Mode capture is browser/WebView based:

- `navigator.mediaDevices.getUserMedia()` acquires the microphone.
- `MediaRecorder` records utterances.
- Web Audio `AnalyserNode` plus `requestAnimationFrame` performs VAD in `src/components/chat/voice-agent.tsx`.
- Transcription is posted to `/api/stt` after VAD ends a turn.

This works while the WebView is foregrounded, but iOS can suspend or heavily throttle WebView JavaScript when the app backgrounds or the device locks. The native project already declares the right intent (`UIBackgroundModes = audio`) and configures `AVAudioSession`, but the critical capture/VAD loop still lives in JavaScript, so the mic indicator/audio session can survive while speech detection does not.

## Goals

1. Keep an active hands-free Agent Mode session reliable across lock screen/background transitions where iOS permits background audio apps to continue.
2. Move the always-on capture/VAD responsibility out of the WebView and into native iOS code.
3. Preserve the existing CrewCMD chat/STT server APIs for v1 where practical.
4. Provide explicit diagnostics so we can prove whether native capture, chunk upload, STT, or chat handoff failed.
5. Degrade gracefully on platforms that do not support native background capture.

## Non-goals for v1

- Wake-word detection from a fully terminated app.
- Bypassing iOS privacy rules or App Review requirements.
- Streaming token-by-token realtime voice responses.
- Android implementation, except for keeping the Capacitor bridge shape portable.
- On-device transcription as a first requirement.

## Proposed architecture

Add a first-party Capacitor plugin, tentatively named `CrewCmdVoiceSession`, implemented in the iOS app target.

```text
React Agent Mode UI
  <-> Capacitor bridge: CrewCmdVoiceSession
      <-> NativeVoiceSessionController.swift
          <-> AVAudioSession + AVAudioEngine
          <-> Native VAD / chunker
          <-> Background-safe upload queue to /api/stt
```

### Responsibilities by layer

#### React/Web layer

- Owns UI state, agent selection, transcript confirmation, and chat handoff.
- Starts/stops native Agent Mode via Capacitor.
- Receives native events:
  - `voiceSessionState`
  - `voiceLevel`
  - `voiceTurnStarted`
  - `voiceChunkQueued`
  - `voiceChunkTranscribed`
  - `voiceTurnFinalized`
  - `voiceSessionDiagnostic`
- Falls back to the existing WebView capture path when native plugin is unavailable.

#### Native plugin layer

- Owns background-capable microphone capture.
- Configures/maintains `AVAudioSession` while Agent Mode is active:
  - category: `.playAndRecord`
  - mode: `.voiceChat` or `.spokenAudio` after testing
  - options: `.allowBluetooth`, `.allowBluetoothA2DP`, `.defaultToSpeaker`, maybe `.mixWithOthers` only if needed
- Uses `AVAudioEngine` input tap for audio frames.
- Computes RMS/voice activity natively on the audio callback or a dedicated serial queue.
- Chunks active speech turns into uploadable audio segments.
- Emits bridge events to the WebView when foregrounded/resumed.
- Queues critical state while the WebView is suspended and flushes events when it resumes.

#### Server layer

For v1, reuse `/api/stt` by uploading chunk files from the WebView or native layer, depending on final implementation choice.

Two viable v1 paths:

1. **Native capture, Web upload**
   - Native captures/chunks audio and stores temp files.
   - When WebView is active, JS asks native for pending chunks and uploads them to `/api/stt`.
   - Simpler auth story because browser cookies/session remain in JS.
   - Less useful if the app remains locked for a long period.

2. **Native capture and native upload** — recommended
   - JS passes current base URL and an ephemeral voice upload token/session token to native at activation.
   - Native uploads chunks directly to `/api/stt` or a new `/api/voice/chunks` endpoint.
   - Native persists retryable chunk metadata until uploaded/transcribed.
   - More work, but actually useful while the WebView is suspended.

Recommendation: implement option 2, but start with a small internal endpoint/token contract so native does not need full web session cookie handling.

## Capacitor plugin API sketch

```ts
export type VoiceSessionStartOptions = {
  baseUrl: string;
  workspaceId?: string;
  sessionKey?: string;
  agentCallsign?: string;
  uploadToken: string;
  silenceThreshold?: number;
  bargeInThreshold?: number;
  minSpeechMs?: number;
  silenceEndMs?: number;
};

export type VoiceSessionStatus = {
  active: boolean;
  state: "idle" | "listening" | "recording" | "transcribing" | "error";
  backgroundCapable: boolean;
  audioSessionActive: boolean;
  pendingChunks: number;
  currentTurnId?: string;
  lastError?: string;
};

export interface CrewCmdVoiceSessionPlugin {
  isAvailable(): Promise<{ available: boolean; platform: string }>;
  start(options: VoiceSessionStartOptions): Promise<VoiceSessionStatus>;
  stop(): Promise<VoiceSessionStatus>;
  muteMic(options: { muted: boolean }): Promise<VoiceSessionStatus>;
  status(): Promise<VoiceSessionStatus>;
}
```

Events:

```ts
CrewCmdVoiceSession.addListener("voiceSessionState", handler);
CrewCmdVoiceSession.addListener("voiceLevel", handler);
CrewCmdVoiceSession.addListener("voiceTurnFinalized", handler);
CrewCmdVoiceSession.addListener("voiceSessionDiagnostic", handler);
```

## Native iOS implementation sketch

### `NativeVoiceSessionController`

Core fields:

- `AVAudioEngine`
- `AVAudioConverter` or `AVAudioFile` writer
- serial `captureQueue`
- serial `uploadQueue`
- `currentTurnId`
- VAD state: `speechStartAt`, `silenceStartAt`, `isRecordingTurn`
- bounded temp directory for chunks
- retry metadata persisted to disk

Flow:

1. `start()`
   - request/verify mic permission
   - configure `AVAudioSession`
   - start `AVAudioEngine`
   - install input tap
   - begin RMS/VAD processing
2. Speech starts
   - create `turnId`
   - start writing chunk file(s)
   - emit `voiceTurnStarted`
3. Speech continues
   - rotate chunk every 4–8 seconds or size threshold
   - enqueue chunk upload/transcription
4. Silence ends turn
   - close final chunk
   - wait for chunk transcriptions or mark partial failure
   - emit `voiceTurnFinalized` with assembled transcript or partial-failure metadata
5. `stop()`
   - stop engine
   - remove tap
   - flush/stop uploads according to user intent
   - deactivate audio session if no playback is active

## Auth/upload token design

Avoid giving native long-lived user credentials.

Add a short-lived endpoint, for example:

- `POST /api/voice/native-session`
  - called from authenticated WebView before starting native mode
  - returns `{ uploadToken, expiresAt, voiceSessionId }`
- Native uploads chunks with `Authorization: Bearer <uploadToken>`
- Server binds token to user/workspace/session/agent and only permits voice chunk/STT endpoints
- Token TTL: 15–60 minutes, renewable while WebView is foregrounded

For v1, native can return finalized transcript to JS and JS can still call the existing chat send path. That keeps OpenClaw/chat auth unchanged.

## UI/UX behaviour

- Rename/copy foreground-only copy accurately when native plugin is unavailable:
  - `Agent mode stays live while CrewCMD remains foregrounded.`
- When native plugin is active:
  - `Background voice session active. iOS may show microphone use while locked.`
- Show a visible status after resume:
  - pending chunks uploaded
  - last transcript captured while locked
  - partial failure requiring review
- Pocket lock remains a user-intent UI lock only. It must not be triggered merely by `visibilitychange`.

## Diagnostics

Emit structured diagnostics for:

- `native.start.requested`
- `native.permission.denied`
- `native.audio-session.configured`
- `native.engine.started`
- `native.engine.interrupted`
- `native.background.entered`
- `native.background.continued`
- `native.chunk.created`
- `native.chunk.upload.retry`
- `native.chunk.transcribed`
- `native.turn.finalized`
- `native.stop.completed`

Include:

- `voiceSessionId`
- `turnId`
- `chunkIndex`
- app foreground/background state
- audio session category/mode
- pending chunk count
- sanitized error string

## Rollout plan

### Phase 0 — design/telemetry

- Land this design.
- Keep the WebView path as fallback.
- Add explicit UI copy distinguishing foreground web mode vs native background mode.

### Phase 1 — plugin skeleton

- Add Capacitor iOS plugin registration.
- Implement `isAvailable`, `start`, `stop`, `status`.
- Configure `AVAudioSession` and start/stop `AVAudioEngine` without upload.
- Emit level diagnostics to prove background capture survives lock/background.

### Phase 2 — native chunk capture

- Write rotating audio chunks to temp files.
- Add native VAD and turn lifecycle events.
- Flush events to JS after resume.

### Phase 3 — upload/STT integration

- Add short-lived native voice upload token endpoint.
- Upload chunks natively with retry/backoff.
- Assemble transcripts in native or server-side session coordinator.
- Return finalized transcript to JS for existing chat send flow.

### Phase 4 — hardening

- Handle audio interruptions: phone calls, Siri, AirPods changes, route changes.
- Add bounded disk cleanup for abandoned chunks.
- Add battery/thermal guardrails.
- Add App Review-facing privacy copy.

## Open questions

1. Is continuous locked-screen hot mic acceptable for the intended CrewCMD distribution/App Review path, or should locked-screen mode require an explicit long-press/session confirmation?
2. Should transcription happen chunk-by-chunk on the existing server, or should native upload to a dedicated voice session endpoint that handles ordered assembly?
3. Should the native layer support interruption/barge-in while TTS is playing in v1, or should it pause capture during playback until the basic background session is proven?
4. What is the minimum acceptable offline behaviour: cache chunks until unlock, or fail fast with visible warning?

## Acceptance criteria for first implementation PR

- On iPhone, with Agent Mode active and native mode enabled, locking the phone does not stop native `AVAudioEngine` level diagnostics for at least 5 minutes.
- Returning to the app shows whether native capture continued, was interrupted, or failed.
- Existing WebView voice mode still works when the native plugin is unavailable.
- No pocket lock is triggered by app backgrounding alone.
- No raw audio persists after successful transcription beyond a short cleanup window.
