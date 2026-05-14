import { describe, expect, it } from "vitest";
import { isOpenClawHeartbeatAck, isOpenClawHeartbeatArtifact } from "./openclaw-heartbeat-artifacts";

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

  it("detects leaked tool call and result artifacts", () => {
    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "call write",
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: "NO_REPLY",
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: `{ "status": "error", "tool": "read", "error": "ENOENT: no such file or directory" }`,
    })).toBe(true);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: JSON.stringify({
        results: [
          {
            path: "memory/2026-04-19-filename-slug.md",
            snippet: "Relevant memory result",
            citation: "memory/2026-04-19-filename-slug.md#L120-L127",
          },
        ],
        corpus: "memory",
      }),
    })).toBe(true);
  });

  it("separates heartbeat acknowledgements from noisy heartbeat internals", () => {
    expect(isOpenClawHeartbeatAck({
      role: "assistant",
      content: "HEARTBEAT_OK",
    })).toBe(true);

    expect(isOpenClawHeartbeatAck({
      role: "assistant",
      content: "# HEARTBEAT.md\n\nActive workstream",
    })).toBe(false);
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

    expect(isOpenClawHeartbeatArtifact({
      role: "user",
      content: "call write",
    })).toBe(false);

    expect(isOpenClawHeartbeatArtifact({
      role: "assistant",
      content: `{"answer":"Use JSON when the API requires it."}`,
    })).toBe(false);
  });
});
