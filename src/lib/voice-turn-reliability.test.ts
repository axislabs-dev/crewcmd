import { describe, expect, it } from "vitest";
import {
  appendVoiceSttMetadata,
  assembleVoiceTranscript,
  getSttRetryDelayMs,
  isRetryableSttFailure,
  parseVoiceSttMetadata,
  summarizeVoiceTurn,
  type VoiceSegment,
} from "./voice-turn-reliability";

function segment(partial: Partial<VoiceSegment> & Pick<VoiceSegment, "segmentIndex">): VoiceSegment {
  return {
    turnId: "voice_turn_test",
    status: "transcribed",
    attemptCount: 1,
    startedAt: 1,
    ...partial,
  };
}

describe("voice turn reliability helpers", () => {
  it("assembles transcript segments in order and ignores duplicate older attempts", () => {
    const assembled = assembleVoiceTranscript([
      segment({ segmentIndex: 2, transcriptText: "  third   part " }),
      segment({ segmentIndex: 0, transcriptText: " first part " }),
      segment({ segmentIndex: 1, transcriptText: " second part ", attemptCount: 1 }),
      segment({ segmentIndex: 1, transcriptText: " second part corrected ", attemptCount: 2 }),
      segment({ segmentIndex: 3, status: "failed", transcriptText: "missing" }),
    ]);

    expect(assembled).toBe("first part second part corrected third part");
  });

  it("summarizes pending and failed segments before final submit", () => {
    const summary = summarizeVoiceTurn({
      turnId: "voice_turn_test",
      mode: "recorded-stt",
      status: "finalizing",
      startedAt: 1,
      segments: [
        segment({ segmentIndex: 0, transcriptText: "hello" }),
        segment({ segmentIndex: 1, status: "uploading" }),
        segment({ segmentIndex: 2, status: "failed" }),
      ],
      warnings: [],
    });

    expect(summary.assembledTranscript).toBe("hello");
    expect(summary.pendingSegments).toBe(1);
    expect(summary.failedSegments).toBe(1);
    expect(summary.transcriptChars).toBe(5);
  });

  it("round trips STT metadata through FormData", () => {
    const formData = new FormData();
    appendVoiceSttMetadata(formData, {
      turnId: "voice_turn_abc",
      segmentIndex: 4,
      isFinalSegment: true,
      durationMs: 5230.4,
      mimeType: "audio/webm",
      captureStartedAt: 100,
      captureEndedAt: 5330,
    });

    expect(parseVoiceSttMetadata(formData)).toEqual({
      turnId: "voice_turn_abc",
      segmentIndex: 4,
      isFinalSegment: true,
      durationMs: 5230,
      mimeType: "audio/webm",
      captureStartedAt: 100,
      captureEndedAt: 5330,
    });
  });

  it("classifies retryable STT failures and backoff delays", () => {
    expect(isRetryableSttFailure(408)).toBe(true);
    expect(isRetryableSttFailure(429)).toBe(true);
    expect(isRetryableSttFailure(500)).toBe(true);
    expect(isRetryableSttFailure(400)).toBe(false);
    expect(isRetryableSttFailure("network_error")).toBe(true);
    expect(isRetryableSttFailure("validation_error")).toBe(false);
    expect(getSttRetryDelayMs(1)).toBe(500);
    expect(getSttRetryDelayMs(2)).toBe(1500);
    expect(getSttRetryDelayMs(99)).toBe(3500);
  });
});
