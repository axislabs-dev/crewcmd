import { describe, expect, it } from "vitest";
import { extractAgentFromSessionKey } from "./openclaw-session-key";

describe("extractAgentFromSessionKey", () => {
  it("extracts the agent id from OpenClaw agent session keys", () => {
    expect(
      extractAgentFromSessionKey("agent:customer-defined-agent:subagent:eb8d60ae-8738-488f-a258-c5e3a06a1068")
    ).toBe("customer-defined-agent");
  });

  it("extracts the agent id from OpenClaw cron session keys", () => {
    expect(extractAgentFromSessionKey("agent:runtime-default:cron:8d513906-97f1-48b7-b88a-ddd6e4a192f7"))
      .toBe("runtime-default");
  });

  it("preserves legacy keys that already start with the agent id", () => {
    expect(extractAgentFromSessionKey("custom-worker:session:abc")).toBe("custom-worker");
  });
});
