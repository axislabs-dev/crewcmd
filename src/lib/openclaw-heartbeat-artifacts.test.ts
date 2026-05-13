import { describe, expect, it } from "vitest";
import { isOpenClawHeartbeatArtifact } from "./openclaw-heartbeat-artifacts";

describe("isOpenClawHeartbeatArtifact", () => {
  it("detects OpenClaw heartbeat poll prompts", () => {
    expect(isOpenClawHeartbeatArtifact({
      role: "user",
      content: "[OpenClaw heartbeat poll]",
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "user",
      content: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. If nothing needs attention, reply HEARTBEAT_OK.",
    })).toBe(true);
  });

  it("detects leaked heartbeat tool artifacts", () => {
    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "call read",
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "# HEARTBEAT.md\n\nActive workstream",
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "HEARTBEAT_OK",
    })).toBe(true);
  });

  it("keeps normal chat content visible", () => {
    expect(isOpenClawHeartbeatArtifact({
      role: "user",
      content: "Can you explain what HEARTBEAT.md does?",
    })).toBe(false);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "HEARTBEAT.md is the optional OpenClaw heartbeat checklist.",
    })).toBe(false);
  });
});
