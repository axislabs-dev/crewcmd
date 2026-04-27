import { describe, expect, it } from "vitest";
import { extractAgentFromSessionKey } from "./openclaw-session-key";

describe("extractAgentFromSessionKey", () => {
  it("extracts the agent id from OpenClaw agent session keys", () => {
    expect(
      extractAgentFromSessionKey("agent:atlas:subagent:eb8d60ae-8738-488f-a258-c5e3a06a1068")
    ).toBe("atlas");
  });

  it("extracts the main agent id from OpenClaw webchat keys", () => {
    expect(extractAgentFromSessionKey("agent:main:cron:8d513906-97f1-48b7-b88a-ddd6e4a192f7"))
      .toBe("main");
  });

  it("preserves legacy keys that already start with the agent id", () => {
    expect(extractAgentFromSessionKey("neo:session:abc")).toBe("neo");
  });
});
