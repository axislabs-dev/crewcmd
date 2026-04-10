import { afterEach, describe, expect, it, vi } from "vitest";
import subagentTraceHook, { clearQueue, extractTraceEnvelope, readQueuedTraceFiles } from "../src/subagent-trace/handler";

describe("subagent-trace hook", () => {
  afterEach(() => {
    clearQueue();
    vi.restoreAllMocks();
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
