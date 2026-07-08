export type VoiceMode = "recorded-stt" | "realtime-relay" | "native-recorded" | "native-realtime";

export type VoiceTurnStatus =
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

export type VoiceSegmentStatus =
  | "queued"
  | "uploading"
  | "streaming"
  | "transcribed"
  | "retrying"
  | "missing"
  | "failed"
  | "cancelled";

export type VoiceTurnFinalizedBy =
  | "vad"
  | "provider"
  | "user-stop"
  | "relay-close"
  | "visibility"
  | "error"
  | "retry";

export interface VoiceTurnWarning {
  code: "transcript_too_long" | "segment_missing" | "capture_degraded" | "background_unverified";
  message: string;
  requiresConfirmation: boolean;
}

export interface VoiceSegment {
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
  retryable?: boolean;
}

export interface VoiceTurn {
  turnId: string;
  mode: VoiceMode;
  status: VoiceTurnStatus;
  startedAt: number;
  endedAt?: number;
  lastInputAt?: number;
  finalizedBy?: VoiceTurnFinalizedBy;
  segments: VoiceSegment[];
  assembledTranscript: string;
  transcriptChars: number;
  pendingSegments: number;
  failedSegments: number;
  warnings: VoiceTurnWarning[];
}

export interface VoiceSttSegmentMetadata {
  turnId?: string;
  segmentIndex?: number;
  isFinalSegment?: boolean;
  durationMs?: number;
  mimeType?: string;
  captureStartedAt?: number;
  captureEndedAt?: number;
}

const STT_RETRY_DELAYS_MS = [500, 1500, 3500] as const;

export function createVoiceTurnId(now = Date.now()): string {
  const randomValue =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  return `voice_turn_${now.toString(36)}_${randomValue}`;
}

export function appendVoiceSttMetadata(formData: FormData, metadata: VoiceSttSegmentMetadata) {
  if (metadata.turnId) formData.append("turnId", metadata.turnId);
  if (typeof metadata.segmentIndex === "number") formData.append("segmentIndex", String(metadata.segmentIndex));
  if (typeof metadata.isFinalSegment === "boolean") formData.append("isFinalSegment", String(metadata.isFinalSegment));
  if (typeof metadata.durationMs === "number") formData.append("durationMs", String(Math.max(0, Math.round(metadata.durationMs))));
  if (metadata.mimeType) formData.append("mimeType", metadata.mimeType);
  if (typeof metadata.captureStartedAt === "number") formData.append("captureStartedAt", String(Math.round(metadata.captureStartedAt)));
  if (typeof metadata.captureEndedAt === "number") formData.append("captureEndedAt", String(Math.round(metadata.captureEndedAt)));
}

export function parseVoiceSttMetadata(formData: FormData): VoiceSttSegmentMetadata {
  const metadata: VoiceSttSegmentMetadata = {};
  const turnId = getFormString(formData, "turnId");
  const segmentIndex = getFormInteger(formData, "segmentIndex");
  const durationMs = getFormNumber(formData, "durationMs");
  const captureStartedAt = getFormNumber(formData, "captureStartedAt");
  const captureEndedAt = getFormNumber(formData, "captureEndedAt");
  const mimeType = getFormString(formData, "mimeType");
  const isFinalSegment = getFormBoolean(formData, "isFinalSegment");

  if (turnId) metadata.turnId = turnId;
  if (segmentIndex !== undefined && segmentIndex >= 0) metadata.segmentIndex = segmentIndex;
  if (isFinalSegment !== undefined) metadata.isFinalSegment = isFinalSegment;
  if (durationMs !== undefined && durationMs >= 0) metadata.durationMs = durationMs;
  if (mimeType) metadata.mimeType = mimeType;
  if (captureStartedAt !== undefined) metadata.captureStartedAt = captureStartedAt;
  if (captureEndedAt !== undefined) metadata.captureEndedAt = captureEndedAt;
  return metadata;
}

export function assembleVoiceTranscript(segments: VoiceSegment[]): string {
  const byIndex = new Map<number, VoiceSegment>();
  for (const segment of segments) {
    if (segment.status !== "transcribed" || !segment.transcriptText?.trim()) continue;
    const existing = byIndex.get(segment.segmentIndex);
    if (!existing || segment.attemptCount >= existing.attemptCount) {
      byIndex.set(segment.segmentIndex, segment);
    }
  }

  return Array.from(byIndex.values())
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map((segment) => segment.transcriptText?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeVoiceTurn(
  turn: Pick<VoiceTurn, "turnId" | "mode" | "status" | "startedAt" | "endedAt" | "lastInputAt" | "finalizedBy" | "warnings"> & {
    segments: VoiceSegment[];
  },
): VoiceTurn {
  const assembledTranscript = assembleVoiceTranscript(turn.segments);
  const pendingSegments = turn.segments.filter((segment) =>
    segment.status === "queued" ||
    segment.status === "uploading" ||
    segment.status === "retrying" ||
    segment.status === "streaming"
  ).length;
  const failedSegments = turn.segments.filter((segment) =>
    segment.status === "failed" || segment.status === "missing"
  ).length;

  return {
    ...turn,
    assembledTranscript,
    transcriptChars: assembledTranscript.length,
    pendingSegments,
    failedSegments,
  };
}

export function isRetryableSttFailure(statusOrErrorCode: number | string | undefined): boolean {
  if (typeof statusOrErrorCode === "number") {
    return statusOrErrorCode === 408 || statusOrErrorCode === 429 || statusOrErrorCode >= 500;
  }

  return (
    statusOrErrorCode === undefined ||
    statusOrErrorCode === "network_error" ||
    statusOrErrorCode === "provider_timeout" ||
    statusOrErrorCode === "provider_failed" ||
    statusOrErrorCode === "rate_limited" ||
    statusOrErrorCode === "internal_error"
  );
}

export function getSttRetryDelayMs(attemptCount: number): number {
  const index = Math.max(0, Math.min(STT_RETRY_DELAYS_MS.length - 1, attemptCount - 1));
  return STT_RETRY_DELAYS_MS[index];
}

function getFormString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getFormNumber(formData: FormData, key: string): number | undefined {
  const value = getFormString(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getFormInteger(formData: FormData, key: string): number | undefined {
  const value = getFormNumber(formData, key);
  if (value === undefined) return undefined;
  return Number.isInteger(value) ? value : undefined;
}

function getFormBoolean(formData: FormData, key: string): boolean | undefined {
  const value = getFormString(formData, key)?.toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
