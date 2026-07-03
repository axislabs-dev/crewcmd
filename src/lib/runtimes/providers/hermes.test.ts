import { afterEach, describe, expect, it, vi } from "vitest";
import { HermesRuntimeProvider } from "./hermes";
import type { RuntimeConnectionRecord } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function hermesRuntime(overrides: Partial<RuntimeConnectionRecord> = {}): RuntimeConnectionRecord {
  return {
    id: "rt_hermes",
    runtimeType: "hermes",
    name: "Hermes",
    gatewayUrl: "http://localhost:8642",
    httpUrl: "http://localhost:8642",
    authToken: "secret",
    metadata: null,
    ...overrides,
  };
}

describe("HermesRuntimeProvider runs", () => {
  it("creates Hermes runs with session headers and optional context", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run_id: "run_123", status: "started" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new HermesRuntimeProvider();
    const result = await provider.createRun(hermesRuntime(), {
      input: "Do the work",
      sessionId: "chat-session",
      sessionKey: " crewcmd:agent:hermes ",
      instructions: "Be concise",
      previousResponseId: "resp_123",
      model: "hermes-agent",
      conversationHistory: [{ role: "user", content: "Earlier" }],
    });

    expect(result).toEqual({
      runId: "run_123",
      status: "started",
      raw: { run_id: "run_123", status: "started" },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8642/v1/runs");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
      "X-Hermes-Session-Key": "crewcmd:agent:hermes",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      input: "Do the work",
      session_id: "chat-session",
      instructions: "Be concise",
      previous_response_id: "resp_123",
      model: "hermes-agent",
      conversation_history: [{ role: "user", content: "Earlier" }],
    });
  });

  it("normalizes Hermes run status responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        object: "hermes.run",
        run_id: "run_123",
        status: "completed",
        session_id: "chat-session",
        model: "hermes-agent",
        output: "Done.",
        usage: { total_tokens: 25 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new HermesRuntimeProvider();
    const result = await provider.getRun(hermesRuntime(), "run_123");

    expect(result).toMatchObject({
      runId: "run_123",
      status: "completed",
      sessionId: "chat-session",
      model: "hermes-agent",
      output: "Done.",
      usage: { total_tokens: 25 },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("streams Hermes run events", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("event: run.completed\ndata: {\"run_id\":\"run_123\"}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new HermesRuntimeProvider();
    const result = await provider.getRunEvents(hermesRuntime(), "run_123", { lastEventId: "evt_1" });

    expect(result.runId).toBe("run_123");
    expect(result.contentType).toBe("text/event-stream");
    await expect(new Response(result.stream).text()).resolves.toBe(
      "event: run.completed\ndata: {\"run_id\":\"run_123\"}\n\n"
    );
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123/events", {
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer secret",
        "Last-Event-ID": "evt_1",
      },
    });
  });

  it("stops Hermes runs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "stopping" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new HermesRuntimeProvider();
    const result = await provider.stopRun(hermesRuntime(), "run_123");

    expect(result).toEqual({
      runId: "run_123",
      status: "stopping",
      raw: { status: "stopping" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123/stop", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("submits Hermes run approvals", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run_id: "run_123", status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new HermesRuntimeProvider();
    const result = await provider.approveRun(hermesRuntime(), "run_123", {
      decision: "approved",
      approvalId: "approval_1",
      reason: "Allowed by operator",
      payload: { tool: "terminal" },
    });

    expect(result).toEqual({
      runId: "run_123",
      status: "running",
      raw: { run_id: "run_123", status: "running" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123/approval", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "approved",
        approval_id: "approval_1",
        reason: "Allowed by operator",
        payload: { tool: "terminal" },
      }),
    });
  });
});
