# Voice Agent Mode — Long-Form Input Reliability (v1)

> Scope: CrewCmd voice agent mode in `src/components/chat/voice-agent.tsx` and STT handoff in `src/app/api/stt/route.ts`.

## Problem Statement

Today, agent mode captures a single browser-side recording until VAD decides speech has ended, then uploads the entire blob to `/api/stt` and waits for a single transcript before handing text to `/api/chat`.

That is fragile for long-form hands-free use:

- a long utterance is buffered entirely in memory before any transcript exists
- a single failed upload/transcription loses the whole turn
- there is no chunk identity, retry, or resumable delivery
- there is no user-visible indication that partial speech was captured but not yet committed
- server-side STT is synchronous and request-scoped, so large uploads are more likely to hit timeouts / provider limits / network failures

This makes driving-style continuous voice interaction unreliable and can fail silently.

## User Story

As a user in agent mode, I can keep speaking naturally for an extended turn, including pauses, and CrewCmd will:

- capture my speech incrementally instead of as one giant blob
- continue making forward progress even if one chunk upload/transcription fails
- never silently drop a long utterance
- clearly show when part of my speech is pending, retrying, or needs confirmation
- only send a final chat turn once the system has either assembled a complete transcript or explicitly surfaced a partial-failure state

## Acceptance Criteria

### Functional

1. Agent mode records audio in rolling chunks while voice activity remains active.
2. Each chunk is assigned a `turnId` and `chunkIndex` on the client.
3. Chunks are uploaded independently to `/api/stt` with enough metadata for ordered reassembly.
4. The client maintains an in-progress transcript buffer for the active voice turn.
5. If one chunk transcription fails, the system retries that chunk without discarding successful sibling chunks.
6. When speech ends, the turn is finalized only after all chunks are either:
   - transcribed successfully, or
   - marked failed and surfaced to the user.
7. If a turn finalizes with failed chunks, the UI shows a clear partial-capture warning before sending, with an action such as:
   - `Send partial transcript`
   - `Retry missing audio`
   - `Discard turn`
8. If all chunks succeed, the assembled transcript is sent once to the existing `sendMessage` / `/api/chat` flow.
9. The system does not silently auto-drop a turn because it exceeded a single upload/transcription limit.

### Reliability

1. A transient failure for one chunk does not invalidate the entire turn.
2. Duplicate chunk uploads are idempotent at the client turn-assembly layer.
3. If the network drops during capture, the UI reflects `Reconnecting / retrying voice chunk` instead of returning to idle silently.
4. The client emits telemetry for chunk lifecycle and final turn outcome.

### Non-Goals for v1

- full duplex streaming STT with token-by-token interim transcripts
- backend persistence of raw audio chunks
- cross-device resumption after browser reload
- speaker diarization
- semantic punctuation repair beyond what STT returns
- redesign of the OpenClaw agent chat transport

## Current Failure Points

## 1. Single-blob capture in agent mode

Current code in `src/components/chat/voice-agent.tsx`:

- starts `MediaRecorder`
- accumulates `chunksRef.current`
- stops only after `SILENCE_END_MS`
- posts one `audio.webm` blob to `/api/stt`

Risk:

- long speech means larger blob, longer request, higher timeout probability
- one failed request loses the whole utterance

## 2. `/api/stt` is single-request, all-or-nothing

Current `src/app/api/stt/route.ts`:

- accepts one `audio` file
- writes temp file
- runs local Whisper or OpenAI transcription synchronously
- returns one final `text`

Risk:

- no chunk metadata
- no partial transcript response
- no retry semantics beyond redoing the whole request
- local whisper timeout is hard-coded to `30000ms`

## 3. No explicit turn state machine

Agent mode currently has UI states like `listening`, `processing`, `speaking`, but no structured state for:

- active turn ID
- pending chunk count
- chunk retry count
- partial transcript readiness
- partial failure requiring user decision

Risk:

- failures collapse into generic `Transcription failed. Try speaking again.`
- the user cannot tell whether some speech was preserved

## 4. No protection against oversized handoff to `/api/chat`

Once transcript text is returned, it is passed directly into normal chat send flow. For pathological transcripts, we currently have no explicit transcript-length guard, segmentation rule, or voice-specific warning.

## Recommended v1 Architecture

## Overview

Keep the existing agent chat transport. Fix reliability one layer earlier by adding **chunked voice-turn capture and transcript assembly on the client**, with **chunk-aware STT** on the server.

### Why this is the right v1

- smallest surface area change
- preserves existing `/api/chat` and OpenClaw integration
- solves the most likely failure mode: long utterances being treated as one fragile request
- enables retries and visibility without committing to full realtime STT infra yet

## Client Architecture

Add a voice-turn coordinator inside `voice-agent.tsx` or a small extracted hook such as `useVoiceTurnCapture()`.

### Proposed client model

```ts
type VoiceTurnState = {
  turnId: string;
  startedAt: number;
  status: "capturing" | "finalizing" | "ready" | "partial-failed" | "sending";
  chunks: Array<{
    chunkIndex: number;
    status: "queued" | "uploading" | "transcribed" | "retrying" | "failed";
    attemptCount: number;
    durationMs: number;
    transcriptText?: string;
    error?: string;
  }>;
  assembledTranscript: string;
  pendingChunks: number;
  failedChunks: number;
};
```

### Chunking strategy

While recording is active:

- create a new `turnId` when speech starts
- use `MediaRecorder.start(timeslice)` with a chunk interval of roughly `4000-8000ms`
- keep recording continuously across chunks until VAD decides the turn is over
- on each `dataavailable`, enqueue the chunk for async upload/transcription immediately

Notes:

- This is not “stop speaking every 5 seconds”. `MediaRecorder` can emit periodic blobs during a continuous recording.
- Keep a small final-tail chunk on stop so the last audio is not stranded.

### Finalization strategy

When VAD ends the turn:

1. stop recorder
2. flush final chunk
3. mark turn `finalizing`
4. wait for all outstanding chunk jobs
5. assemble transcript in `chunkIndex` order
6. if no failed chunks, call existing `onTranscript(assembledTranscript)`
7. if any failed chunks, surface partial-failure UI instead of silently sending

### Retry policy

Per chunk:

- retry up to `2` additional times (`3` total attempts)
- exponential backoff: `500ms`, `1500ms`
- retry on network errors and `5xx`
- do not blindly retry `4xx` except `408` / `429`
- if offline, pause retries until connectivity returns

### UX states

Add agent-mode copy for voice capture reliability:

- `Listening…`
- `Transcribing speech… 3 parts pending`
- `Retrying 1 failed part…`
- `Part of your speech could not be transcribed`
- `Send partial transcript` / `Retry missing part` / `Discard`

Minimum visible indicators:

- pending chunk count while finalizing
- partial transcript preview when failed
- non-silent error banner

## Server Architecture

Extend `/api/stt` to accept chunk-aware metadata while remaining backward-compatible.

### Request shape

Continue multipart upload with `audio`, plus optional fields:

- `turnId`
- `chunkIndex`
- `isFinalChunk`
- `durationMs`
- `mimeType`

### Response shape

```json
{
  "text": "partial transcript for this chunk",
  "provider": "local" | "openai",
  "turnId": "...",
  "chunkIndex": 4,
  "isFinalChunk": false,
  "durationMs": 5230
}
```

### Backend behavior for v1

- transcribe each chunk independently
- return transcript for that chunk only
- do not persist server-side chunk assembly yet
- log chunk metadata and result status for telemetry
- keep existing non-chunk callers working

### STT backend adjustments

Recommended small changes in `src/app/api/stt/route.ts`:

1. raise or make configurable local whisper timeout for chunk jobs
2. return structured error codes (`provider_timeout`, `decode_failed`, `backend_unavailable`)
3. include provider and elapsed time in success/failure logs
4. validate chunk metadata and echo it back in the response

## Transcript Assembly Rules

Chunk transcript assembly should be deterministic and conservative.

### v1 rules

- sort by `chunkIndex`
- trim outer whitespace per chunk
- join with a single space
- collapse accidental double spaces
- do not attempt aggressive deduplication in v1

Reason: adjacent chunk overlap handling is useful, but a clean first release should avoid clever merge logic unless overlap is intentionally introduced.

## Telemetry Requirements

Emit structured client and server logs/events for every turn.

### Client events

- `voice_turn_started`
  - `turnId`
  - `voiceMode`
- `voice_chunk_enqueued`
  - `turnId`, `chunkIndex`, `durationMs`, `sizeBytes`
- `voice_chunk_attempt`
  - `turnId`, `chunkIndex`, `attemptCount`
- `voice_chunk_succeeded`
  - `turnId`, `chunkIndex`, `latencyMs`, `provider`
- `voice_chunk_failed`
  - `turnId`, `chunkIndex`, `attemptCount`, `errorCode`
- `voice_turn_ready`
  - `turnId`, `chunkCount`, `transcriptChars`
- `voice_turn_partial_failed`
  - `turnId`, `chunkCount`, `failedChunks`, `partialTranscriptChars`
- `voice_turn_sent`
  - `turnId`, `chunkCount`, `transcriptChars`
- `voice_turn_discarded`
  - `turnId`, `reason`

### Server logs / metrics

- `stt_chunk_received`
- `stt_chunk_transcribed`
- `stt_chunk_failed`

Include:

- `turnId`
- `chunkIndex`
- `durationMs`
- `sizeBytes`
- `provider`
- `elapsedMs`
- `outcome`
- `statusCode` / `errorCode`

## UX Fallback Requirements

If reliability cannot be guaranteed, the user should know exactly what happened.

### Required fallback behavior

1. **Backend unavailable before capture**
   - current behavior may fall back to browser STT in tap-to-record mode
   - in agent mode, do not silently promise reliability if only browser speech fallback exists
   - show: `Reliable long-form voice requires server speech transcription. Agent mode may be limited right now.`

2. **Partial turn failure after capture**
   - retain transcribed chunks in memory
   - present partial transcript
   - allow retry of missing chunks if raw chunk blobs are still retained locally

3. **Transcript too large for a single chat send**
   - split into numbered sequential user messages only if a defined size threshold is exceeded
   - otherwise warn and request confirmation

For v1, preferred path is **warn + manual confirm**, not automatic multi-message splitting.

## In Scope

- chunked recording in voice agent mode
- per-chunk STT upload/transcription
- turn/chunk state tracking in client
- per-chunk retries with backoff
- partial-failure UI
- telemetry for chunk and turn lifecycle
- backward-compatible `/api/stt` metadata support
- modest STT timeout/error-code improvements

## Out of Scope

- websocket or bidirectional streaming STT provider integration
- storing audio chunks in DB/object storage
- server-side turn assembly service
- transcript confidence scoring
- multilingual routing or language auto-detect
- redesigning VAD thresholds beyond small tuning needed for chunking
- changes to OpenClaw gateway chat protocol

## Suggested Implementation Plan

### Step 1 — Chunk-aware STT contract

Update `/api/stt` to:

- accept optional chunk metadata fields
- echo chunk metadata in response
- return structured errors
- add logging around provider choice and latency

### Step 2 — Client turn coordinator

Refactor `voice-agent.tsx` to maintain an active voice turn object with:

- `turnId`
- `chunkIndex`
- pending upload map
- retry counters
- assembled partial transcript

### Step 3 — Rolling chunk upload

Switch continuous recording to periodic `dataavailable` handling and enqueue chunk transcription jobs while recording continues.

### Step 4 — Finalization + partial failure UX

On silence/end:

- stop capture
- await outstanding chunks
- assemble transcript
- either send completed transcript or show partial-failure action sheet/banner

### Step 5 — Telemetry + guardrails

Add console/server logs first; wire to analytics later if desired.

## Open Questions / Unknowns

1. **Practical chunk duration:** start with `~5s`, but test on mobile Safari and Chrome while screen-locked / navigating.
2. **Browser behavior:** confirm `MediaRecorder.start(timeslice)` is stable in the mobile browsers Roger actually uses while driving.
3. **Provider limits:** define a transcript char threshold before `/api/chat` should warn instead of send blindly.
4. **Chunk retry retention:** if a failed chunk should be retryable after turn end, keep the original blob until the user resolves the turn.
5. **Offline behavior:** whether to queue unsent chunks briefly or require the user to retry once connectivity returns.

## Recommended First Task Breakdown

### Task A
**Title:** Add chunk-aware STT contract and telemetry for voice turns

Deliverables:

- `/api/stt` metadata support
- structured error codes
- latency/provider logging
- compatibility with existing `VoiceRecorder`

### Task B
**Title:** Implement chunked long-form capture and retry flow in voice agent mode

Deliverables:

- turn/chunk state machine
- rolling chunk uploads
- finalize/wait/assemble behavior
- partial failure UI

### Task C
**Title:** Add transcript size guardrails and voice reliability UX copy

Deliverables:

- transcript length threshold
- warning/confirm flow for oversized turn send
- clear status/error copy in agent mode

## Recommendation

Yes — this should become a Forge implementation task next.

Best next task title:

**Implement reliable chunked long-form voice capture for agent mode**
