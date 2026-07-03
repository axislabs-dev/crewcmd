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
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
      body: undefined,
    });
  });
});
