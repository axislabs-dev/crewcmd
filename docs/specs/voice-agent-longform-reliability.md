# Voice Turn Reliability for Hands-Free Agent Mode

> Status: design proposal; first recorded-STT implementation slice in progress
> Scope: long-form hands-free voice turns across recorded voice agent mode and live/realtime agent mode.
> Related: `docs/specs/native-background-agent-session.md`, `docs/plans/realtime-voice-openclaw-passthrough.md`.

## Problem Statement

Roger is using CrewCMD hands-free in agent mode while driving. Voice input appears to cut off after a similar number of characters or words, not only after pauses. That points to more than ordinary VAD silence handling: a browser, STT provider, request body, transcript field, realtime event, gateway relay, or chat handoff may be truncating a single large audio/transcript unit, or the system may be finalizing a voice turn before the user is done.

CrewCMD currently has two voice paths with different reliability risks:

- **Recorded voice agent mode** in `src/components/chat/voice-agent.tsx` records one browser-side blob until VAD stops the turn, posts it to `/api/stt`, waits for one transcript, then calls the existing chat send path.
- **Live/realtime agent mode** starts an OpenClaw realtime session through `src/lib/realtime-voice-client.ts`, streams PCM frames through `RealtimeGatewayRelaySession`, persists only final transcript events, and cancels assistant output on local barge-in detection.

Both paths lack a shared voice-turn reliability contract. They do not consistently track turn IDs, segment indexes, finalization gates, partial failure states, transcript length limits, interruption causality, or mobile lifecycle constraints.

## Goals

1. Never silently lose or truncate a long hands-free user turn.
2. Make recorded STT mode resilient to audio/request/transcript length caps by chunking capture and STT.
3. Make live/realtime mode resilient to premature turn finalization, lost final transcript events, relay disconnects, and accidental assistant interruption.
4. Share turn IDs, sequencing, assembly, diagnostics, and UI states across both modes.
5. Keep mode-specific adapters small: blob STT mode owns `MediaRecorder` and `/api/stt`; realtime mode owns PCM relay and realtime events.
6. Support mobile/iOS browser and Capacitor constraints without pretending JavaScript timers keep running while a WebView is suspended.
7. Make the first implementation PR obvious and reviewable.

## Non-Goals

- Replacing the existing chat send path or OpenClaw gateway protocol.
- Implementing provider-native streaming STT for recorded mode in the first slice.
- Persisting raw audio permanently.
- Cross-device recovery after browser reload.
- Wake-word detection while the app is terminated.
- Solving native iOS background capture in this document; that remains covered by `native-background-agent-session.md`.

## Current Code Path Findings

### Recorded Voice Agent Mode

Relevant files:

- `src/components/chat/voice-agent.tsx`
- `src/components/chat/voice-recorder.tsx`
- `src/app/api/stt/route.ts`

Current behavior:

- `VoiceAgent` starts `MediaRecorder` when VAD sees speech.
- `recorder.start(100)` emits small `dataavailable` blobs, but the client only appends them to `chunksRef`.
- On VAD silence, `recorder.stop()` builds one large `Blob` and posts one multipart request to `/api/stt`.
- `/api/stt` accepts one `audio` blob, writes one temp file, tries local Whisper with a 30s transcription timeout, then optionally falls back to OpenAI Whisper.
- The response is a single `{ text, provider }` payload with no chunk metadata, partial result, retry contract, or structured length diagnostic.

Failure risks:

- Long speech becomes one memory blob, one HTTP request, one provider call, and one transcript handoff.
- Any upload, timeout, provider cap, temp-file decode failure, or response truncation loses the whole turn.
- VAD finalization and STT failure both collapse into generic UI states.
- There is no transcript length guard before the normal chat send flow.

### Live / Realtime Agent Mode

Relevant files:

- `src/lib/realtime-voice-client.ts`
- `src/lib/realtime-voice-gateway-relay.ts`
- `src/lib/realtime-voice-audio.ts`
- `src/components/chat/voice-agent.tsx`
- `src/app/chat/page.tsx`

Current behavior:

- `VoiceAgent` starts realtime mode when `NEXT_PUBLIC_CREWCMD_REALTIME_VOICE=1`, a runtime ID exists, and OpenClaw returns a `gateway-relay` transport.
- `RealtimeGatewayRelaySession` captures mic audio with `getUserMedia`, converts audio frames to PCM16, posts base64 audio chunks via `/talk/realtime/relay`, and receives relay events over SSE.
- Realtime transcript events are forwarded to chat; `src/app/chat/page.tsx` persists only `final` transcript events.
- Local barge-in detection cancels assistant output and sends `cancelOutput`.

Failure risks:

- PCM frame posts are fire-and-forget; failures call `onError` but do not sequence, retry, or mark missing audio ranges.
- Transcript finality is provider/relay-driven. A premature final event can create a durable chat message before the user has finished.
- Lost SSE events, relay reconnects, or provider turn caps can drop final transcript state without an assembled local turn state.
- Barge-in can cancel assistant audio while user speech is still uncertain, and the cancellation is not tied to a turn/segment diagnostic.
- Mobile browser throttling can pause frame upload or event handling without a clear partial-turn status.

## Design Principle: One Reliability Layer, Two Adapters

Add a shared **voice-turn reliability layer** that owns the lifecycle of a spoken user turn, independent of transport.

```text
Voice UI / Agent Mode
  -> Shared VoiceTurnCoordinator
      - turn IDs and segment IDs
      - sequencing and idempotency
      - active/finalizing/partial-failed/sent state
      - transcript assembly and length guardrails
      - finalization gates
      - diagnostics and telemetry
      - mobile lifecycle status
      -> BlobSttAdapter
          - MediaRecorder chunk rotation
          - /api/stt chunk upload
          - per-chunk retry
      -> RealtimeVoiceAdapter
          - PCM frame sequencing
          - relay event correlation
          - transcript delta/final assembly
          - interruption/cancel correlation
```

The coordinator should be a plain TypeScript module or hook with deterministic unit tests. UI components should subscribe to coordinator state rather than deriving long-form reliability from `listening`, `processing`, and `speaking` alone.

## Shared Voice Turn Model

```ts
type VoiceMode = "recorded-stt" | "realtime-relay" | "native-recorded" | "native-realtime";

type VoiceTurnStatus =
  | "idle"
  | "capturing"
  | "assistant-speaking"
  | "interrupted"
  | "finalizing"
  | "ready"
  | "partial-failed"
  | "needs-confirmation"
  | "sending"
  | "sent"
  | "discarded";

type VoiceSegmentStatus =
  | "queued"
  | "uploading"
  | "streaming"
  | "transcribed"
  | "retrying"
  | "missing"
  | "failed"
  | "cancelled";

type VoiceTurn = {
  turnId: string;
  mode: VoiceMode;
  status: VoiceTurnStatus;
  startedAt: number;
  endedAt?: number;
  lastInputAt?: number;
  finalizedBy?: "vad" | "provider" | "user-stop" | "relay-close" | "visibility" | "error";
  segments: VoiceSegment[];
  assembledTranscript: string;
  transcriptChars: number;
  pendingSegments: number;
  failedSegments: number;
  warnings: VoiceTurnWarning[];
};

type VoiceTurnWarning = {
  code: "transcript_too_long" | "segment_missing" | "capture_degraded" | "background_unverified";
  message: string;
  requiresConfirmation: boolean;
};

type VoiceSegment = {
  turnId: string;
  segmentIndex: number;
  transportSequenceStart?: number;
  transportSequenceEnd?: number;
  status: VoiceSegmentStatus;
  attemptCount: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  sizeBytes?: number;
  transcriptText?: string;
  final?: boolean;
  errorCode?: string;
};
```

### Coordinator Responsibilities

- Create a `turnId` on first confirmed user speech.
- Assign monotonic `segmentIndex` values for recorded chunks and realtime transcript/audio windows.
- Reject duplicate segment completions by `turnId + segmentIndex + attempt`.
- Track all pending work before final send.
- Assemble transcripts deterministically in segment order.
- Gate finalization until the active mode reports an end-of-turn signal and all required segments are resolved.
- Surface partial failure instead of auto-sending a questionable transcript.
- Record why a turn ended and whether assistant output was interrupted.
- Enforce transcript size guardrails before calling the chat send path.

## Recorded STT Adapter

The recorded adapter should keep the current `/api/chat` handoff but stop treating a long utterance as one blob.

### Capture Strategy

- Use a production chunk interval of `4000-8000ms`, but make each uploaded chunk a complete `MediaRecorder` start/stop output rather than a continuation blob from `start(timeslice)`.
- Rotate uploadable chunks by stopping the current recorder and immediately starting a new recorder while the user keeps speaking; do not require the user to pause every few seconds.
- Treat timeslice `dataavailable` blobs as unsafe for upload unless the browser/container is proven to emit standalone decodable files for every slice.
- Keep a final tail chunk on stop so trailing speech is not stranded.
- Retain chunk blobs in memory until the turn is sent, discarded, or the user resolves a partial failure.
- Bound retained audio by both time and bytes; if exceeded, move to `needs-confirmation` with a clear warning.

### `/api/stt` Contract

Keep existing callers working, but accept optional metadata:

- `turnId`
- `segmentIndex`
- `isFinalSegment`
- `durationMs`
- `mimeType`
- `captureStartedAt`
- `captureEndedAt`

Response shape:

```json
{
  "text": "transcript for this segment",
  "provider": "local",
  "turnId": "voice_turn_123",
  "segmentIndex": 4,
  "isFinalSegment": false,
  "durationMs": 5230,
  "elapsedMs": 821
}
```

Error shape:

```json
{
  "error": "Transcription timed out",
  "errorCode": "provider_timeout",
  "retryable": true,
  "turnId": "voice_turn_123",
  "segmentIndex": 4
}
```

### Retry Policy

- Retry network errors, `408`, `429`, and `5xx`.
- Do not retry validation errors or unsupported audio containers without changing the request.
- Use 3 total attempts with backoff around `500ms`, `1500ms`, and `3500ms`.
- Pause retries while offline and resume on `online`.
- Preserve successful sibling segments.

### Assembly Rules

- Sort by `segmentIndex`.
- Trim outer whitespace per segment.
- Join with a single space.
- Collapse repeated whitespace.
- Do not attempt aggressive overlap removal until intentional overlap is introduced and tested.

## Realtime Voice Adapter

Realtime mode should keep its low-latency relay but add enough structure to diagnose and survive long turns.

### Audio Uplink Sequencing

- Attach a monotonic `audioSequence` or `frameIndex` to each PCM relay post.
- Track send latency and failed posts by sequence range.
- Batch small frames into bounded windows if network overhead becomes a bottleneck, but keep windows short enough for low-latency barge-in.
- On a failed frame post, mark the sequence range `missing` and surface realtime degradation instead of silently continuing as if capture is intact.

### Transcript Event Correlation

The relay/provider may emit interim and final transcript events. The adapter should normalize them into coordinator segments:

- interim transcript: updates the current open segment
- final transcript: closes a segment or turn only when the provider/relay gives a reliable end-of-turn signal
- duplicate final transcript: idempotent update, not a second chat message
- empty final: diagnostic event, not a turn by itself

### Finalization Guard

A realtime user turn should not become durable merely because one `final` transcript event arrived. The coordinator should require one of:

- provider/relay event explicitly marks user turn complete
- assistant tool call begins and all preceding user transcript segments are stable
- a local silence/end-of-turn timeout fires after the last transcript/audio activity
- the user manually stops realtime mode

The first implementation can use a conservative grace window, for example `700-1200ms` after the last final transcript or local input activity, before persisting the user transcript.

### Assistant Interruption and Barge-In

When local barge-in cancels assistant output:

- create or continue the active user `turnId`
- record `interruptionId`, output playback position, and current input sequence
- suppress echo frames as today, but log the suppressed sequence range
- do not mark the previous assistant response as fully heard unless a mark/ack confirms playback completion
- surface repeated false barge-ins as a mobile tuning diagnostic

### Relay Reconnect / Loss

For v1, if the SSE stream or relay post path fails during an active turn:

- stop auto-sending realtime transcript finals
- mark the turn `partial-failed` or `needs-confirmation`
- leave the visible transcript preview in place
- offer fallback to recorded STT mode for the next turn

Reliable replay of live PCM after disconnect is out of scope for the first implementation unless the gateway adds an acknowledged sequence protocol.

## Mobile and iOS Constraints

Mobile web and Capacitor should share the coordinator but use different capture guarantees.

- Foreground web capture may rely on `MediaRecorder`, `AudioContext`, `requestAnimationFrame`, and SSE while the screen is active.
- iOS Safari/WebView may throttle or suspend JavaScript timers, audio callbacks, fetches, and EventSource while backgrounded or locked.
- Capacitor native mode should eventually provide native turn/segment events using the contract in `native-background-agent-session.md`.
- The UI must distinguish `foreground reliable` from `background capable`.
- If background capture cannot be proven for the current platform, CrewCMD should say so in state text and diagnostics.

Minimum mobile diagnostics:

- visibility changes during active turn
- audio context suspend/resume
- media recorder pause/stop/error
- EventSource close/error
- relay post failures
- native session availability/background capability
- wake-lock acquire/release

## UX Requirements

Hands-free users need short, decisive states that do not require reading while driving.

Required states:

- `Listening`
- `Capturing long turn`
- `Transcribing 3 parts`
- `Retrying 1 part`
- `Live voice reconnecting`
- `Partial speech captured`
- `Review before sending`

Required actions when a turn is partial:

- `Send captured text`
- `Retry missing audio`
- `Discard`

Rules:

- Never return to idle after a failed long turn without a visible reason.
- Never auto-send a transcript when required segments are missing.
- Do not auto-split long transcripts into multiple chat messages in v1; warn and ask for confirmation.
- Keep partial transcript preview available until the user resolves the turn or starts a new one.

## Telemetry and Diagnostics

Use one shared event vocabulary and include `mode` on every event.

Client events:

- `voice_turn_started`
- `voice_segment_created`
- `voice_segment_sent`
- `voice_segment_retrying`
- `voice_segment_transcribed`
- `voice_segment_missing`
- `voice_segment_failed`
- `voice_turn_finalization_requested`
- `voice_turn_ready`
- `voice_turn_needs_confirmation`
- `voice_turn_partial_failed`
- `voice_turn_sent`
- `voice_turn_discarded`
- `voice_realtime_interruption`
- `voice_realtime_relay_error`
- `voice_mobile_lifecycle_change`

Server events:

- `stt_segment_received`
- `stt_segment_transcribed`
- `stt_segment_failed`
- `realtime_relay_audio_received`
- `realtime_relay_audio_failed`
- `realtime_relay_transcript_event`
- `realtime_relay_turn_finalized`

Common fields:

- `turnId`
- `mode`
- `segmentIndex`
- `audioSequenceStart`
- `audioSequenceEnd`
- `durationMs`
- `sizeBytes`
- `attemptCount`
- `provider`
- `elapsedMs`
- `errorCode`
- `retryable`
- `finalizedBy`
- `transcriptChars`
- `userAgent`
- `visibilityState`
- `nativeBackgroundCapable`

Diagnostics should be useful without raw audio. Do not log full transcript text by default; log character counts and hashes only when needed.

## Acceptance Criteria

### Shared Reliability

1. Every captured user voice turn has a stable `turnId`.
2. Every audio/transcript unit has an ordered segment or sequence identity.
3. Duplicate segment completions are idempotent.
4. A turn is sent only after finalization gates pass.
5. Missing segments create a visible partial-failure or confirmation state.
6. Transcript length guardrails prevent silent chat handoff truncation.
7. Client diagnostics identify whether a turn ended by VAD, provider finality, user stop, relay close, visibility change, or error.

### Recorded STT Mode

1. Long speech is transcribed from rolling chunks instead of one blob.
2. One failed chunk can retry without discarding successful chunks.
3. `/api/stt` remains backward-compatible for single-blob callers.
4. `/api/stt` returns structured error codes and echoes chunk metadata.
5. Final transcript assembly is deterministic and tested.

### Realtime Mode

1. PCM uplink frames or windows are sequenced and measured.
2. Relay post and SSE failures move active turns into a visible degraded state.
3. Interim/final realtime transcripts are normalized before durable persistence.
4. A single premature final transcript event cannot immediately commit a long user turn.
5. Barge-in cancellation records the active user turn and interruption diagnostic.

### Mobile

1. Foreground web reliability and native background capability are reported separately.
2. Visibility/audio-context/media-recorder/SSE lifecycle changes are recorded during active turns.
3. iOS limitations are visible in diagnostics and user state, not hidden as generic transcription failures.

## Phased Implementation Slices

### PR 1: Shared Voice Turn Types and Recorded STT Metadata

Files likely touched:

- `src/lib/voice-turn-reliability.ts`
- `src/app/api/stt/route.ts`
- focused tests for metadata parsing, error shapes, and assembly helpers

Deliverables:

- shared turn/segment types
- transcript assembly helper
- `/api/stt` chunk metadata parsing and response echo
- structured STT error codes
- diagnostics fields, still compatible with existing callers

### PR 2: Chunked Recorded Agent Capture

Files likely touched:

- `src/components/chat/voice-agent.tsx`
- `src/lib/voice-turn-reliability.ts`
- component/unit tests as feasible

Deliverables:

- rolling chunk upload from agent mode
- per-chunk retry
- finalization gate before `onTranscript`
- partial-failure UI state
- transcript size confirmation

Implementation note:

- The first combined implementation slice keeps live/realtime behavior unchanged, but recorded agent mode now creates a stable turn ID, uploads bounded chunks while capture continues, retries each failed chunk independently, assembles successful segments in order, and requires an explicit user action before sending partial or unusually long captured text.

### PR 3: Realtime Turn Normalization

Files likely touched:

- `src/lib/realtime-voice-gateway-relay.ts`
- `src/lib/realtime-voice-client.ts`
- `src/app/chat/page.tsx`
- realtime tests

Deliverables:

- sequence metadata on PCM relay posts where protocol permits
- normalized transcript events through the shared coordinator
- final transcript grace/finalization gate
- relay failure degradation state
- interruption diagnostics

### PR 4: Mobile Reliability Diagnostics

Files likely touched:

- `src/components/chat/voice-agent.tsx`
- `src/lib/native-voice-session.ts`
- mobile/native docs or tests as needed

Deliverables:

- lifecycle diagnostics during active turns
- explicit foreground/background capability status
- handoff path for native turn events to the shared coordinator

## Test Plan

Unit tests:

- transcript assembly orders segments and ignores duplicates
- finalization refuses to send with pending or failed required segments
- retry policy classifies network, `408`, `429`, `5xx`, and validation failures correctly
- realtime transcript normalization handles interim, final, duplicate final, empty final, and premature final events
- barge-in diagnostics include interruption and active turn IDs

Integration tests:

- `/api/stt` accepts old single-blob requests unchanged
- `/api/stt` echoes chunk metadata for chunked requests
- `/api/stt` returns structured retryable errors for timeout-like failures
- recorded agent mode sends exactly one assembled transcript after all chunks succeed
- recorded agent mode shows partial failure if one chunk exhausts retries
- realtime relay failure prevents silent durable transcript persistence

Manual/mobile validation:

- 2, 5, and 10 minute hands-free monologues in desktop Chrome
- same tests in mobile Safari or Capacitor foreground
- network drop during recorded chunk upload
- network drop during realtime relay/SSE
- assistant speaking while user barges in
- lock/background/resume where platform permits, verifying state text and diagnostics

## Production Validation Plan

1. Ship diagnostics first behind existing voice mode behavior.
2. Enable chunked recorded STT for local/dev users behind a feature flag.
3. Record per-turn metrics: chunk count, retry count, failed chunks, finalization reason, transcript chars, and time to send.
4. Compare truncation reports before/after chunking.
5. Roll out realtime finalization gating behind `NEXT_PUBLIC_CREWCMD_REALTIME_VOICE` or a narrower runtime capability flag.
6. Keep a visible fallback to recorded STT when realtime relay quality degrades.
7. Review logs for any spike in partial-failure prompts before making chunked mode default.

Success metrics:

- no silent long-turn drops in manual driving-style tests
- partial failures are visible and recoverable
- P95 recorded turn finalization remains acceptable for normal utterances
- realtime premature-final reports trend down
- diagnostics can identify whether failures are capture, upload, STT, relay, finality, or chat handoff

## Risks

- Independent STT chunks may introduce punctuation gaps or repeated words at boundaries.
- More requests may increase server load and provider cost.
- Retaining retryable audio chunks in memory can pressure mobile browsers.
- Conservative realtime finalization gates may delay visible chat persistence.
- Provider realtime protocols may not expose enough turn metadata for perfect finalization.
- iOS background behavior cannot be guaranteed from WebView JavaScript alone.
- Too much UI warning can distract hands-free users if not designed carefully.

Mitigations:

- Start with 4-8 second chunks and no overlap.
- Bound retained chunks by time and bytes.
- Keep retries small and observable.
- Use feature flags for recorded chunking and realtime gating.
- Prefer short state text and optional review surfaces.
- Route true background capture through the native session design.

## First Implementation PR

Recommended first PR:

**Title:** `feat: add voice turn reliability primitives and STT metadata`

Reviewable scope:

- create the shared turn/segment model and transcript assembly helper
- extend `/api/stt` with optional metadata echo and structured error shape
- add unit tests for assembly, idempotency, and metadata parsing
- do not change capture behavior yet

That PR gives later recorded and realtime adapters a common contract without widening the first implementation into UI, audio capture, realtime relay, and server behavior all at once.
