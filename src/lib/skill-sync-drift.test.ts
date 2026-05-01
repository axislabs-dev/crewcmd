import { describe, expect, it } from "vitest";
import { deriveSkillSyncDrift } from "./skill-sync-drift";

describe("deriveSkillSyncDrift", () => {
  it("marks missing runtime skill metadata as requiring review", () => {
    expect(deriveSkillSyncDrift({ status: "missing" })).toEqual({
      driftStatus: "missing",
      requiresReview: true,
    });
  });

  it("marks synced skills without a checksum as unknown", () => {
    expect(deriveSkillSyncDrift({ status: "synced", checksum: null })).toEqual({
      driftStatus: "unknown",
      requiresReview: true,
    });
  });

  it("marks changed checksums as drift that requires review", () => {
    expect(deriveSkillSyncDrift({
      status: "synced",
      checksum: "next",
      previousChecksum: "previous",
    })).toEqual({
      driftStatus: "changed",
      requiresReview: true,
    });
  });

  it("marks unchanged synced checksums as current", () => {
    expect(deriveSkillSyncDrift({
      status: "synced",
      checksum: "same",
      previousChecksum: "same",
    })).toEqual({
      driftStatus: "current",
      requiresReview: false,
    });
  });
});
