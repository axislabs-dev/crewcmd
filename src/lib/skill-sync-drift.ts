export type SkillSyncStatus = "synced" | "missing";
export type SkillSyncDriftStatus = "current" | "changed" | "missing" | "unknown";

export interface SkillSyncDriftInput {
  status: SkillSyncStatus;
  checksum?: string | null;
  previousChecksum?: string | null;
}

export interface SkillSyncDriftSummary {
  driftStatus: SkillSyncDriftStatus;
  requiresReview: boolean;
}

export function deriveSkillSyncDrift(input: SkillSyncDriftInput): SkillSyncDriftSummary {
  if (input.status === "missing") {
    return { driftStatus: "missing", requiresReview: true };
  }

  const checksum = normalize(input.checksum);
  const previousChecksum = normalize(input.previousChecksum);

  if (!checksum) {
    return { driftStatus: "unknown", requiresReview: true };
  }

  if (previousChecksum && previousChecksum !== checksum) {
    return { driftStatus: "changed", requiresReview: true };
  }

  return { driftStatus: "current", requiresReview: false };
}

function normalize(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
