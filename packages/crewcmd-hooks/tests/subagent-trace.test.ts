import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import subagentTraceHook, { clearQueue, extractTraceEnvelope, readQueuedTraceFiles, resolveCrewcmdUrl } from "../src/handler";

describe("subagent-trace hook", () => {
  const originalCrewcmdUrl = process.env.CREWCMD_URL;

  beforeEach(() => {
    process.env.CREWCMD_URL = "http://localhost:3000";
  });

  afterEach(() => {
    clearQueue();
    vi.restoreAllMocks();
    if (originalCrewcmdUrl === undefined) delete process.env.CREWCMD_URL;
    else process.env.CREWCMD_URL = originalCrewcmdUrl;
  });

  it("extracts spawn payloads into CrewCmd trace envelopes", () => {
    const envelope = extractTraceEnvelope({
      toolName: "sessions_spawn",
      input: {
        agentId: "Cipher",
        companyId: "company-123",
        task: "Implement the hook pack",
        taskId: "task-42"
      },
      result: {
        sessionKey: "sess_abc",
        sessionId: "child_123",
        message: "Done and dusted."
      }
    });

    expect(envelope).toMatchObject({
      toolName: "sessions_spawn",
      agentId: "cipher",
      companyId: "company-123",
      sessionKey: "sess_abc",
      openclawSessionId: "child_123",
      taskId: "task-42",
      requestContent: "Implement the hook pack",
      responseContent: "Done and dusted."
    });
  });

  it("ignores unrelated tools", () => {
    expect(extractTraceEnvelope({ toolName: "read", input: {}, result: {} })).toBeNull();
  });

  it("prefers CREWCMD_URL from the environment", () => {
    process.env.CREWCMD_URL = "https://crewcmd.example.com/";
    expect(resolveCrewcmdUrl()).toBe("https://crewcmd.example.com");
  });

  it("queues payloads and returns undefined", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const result = subagentTraceHook({
      toolName: "sessions_spawn",
      input: { agentId: "Forge", companyId: "co_1", task: "Ship it" },
      result: { message: "Shipped", sessionKey: "sess_1" }
    });

    expect(result).toBeUndefined();
    expect(readQueuedTraceFiles().length).toBe(1);
  });
});
