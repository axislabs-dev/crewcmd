import { afterEach, describe, expect, it, vi } from "vitest";
import { HermesApiAdapter } from "./hermes-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("HermesApiAdapter", () => {
  it("posts OpenAI chat completions requests to Hermes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new HermesApiAdapter();
    const result = await adapter.executeTask("Do the work", {
      url: "http://localhost:8642/v1",
      model: "hermes-agent",
      headers: { Authorization: "Bearer secret" },
    });

    expect(result).toEqual({ output: "done", exitCode: 0 });
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8642/v1/chat/completions");
    expect(requestInit.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
    });
    const body = JSON.parse(requestInit.body as string);
    expect(body).toMatchObject({ model: "hermes-agent", stream: false });
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("CrewCmd worker through the Hermes Agent API");
    expect(body.messages[1]).toEqual({ role: "user", content: "Do the work" });
  });

  it("uses apiKey when Authorization header is not present", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new HermesApiAdapter();
    await adapter.executeTask("hello", { url: "http://localhost:8642", apiKey: "secret" });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("sends Hermes session keys as stable memory headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new HermesApiAdapter();
    await adapter.executeTask("hello", {
      url: "http://localhost:8642",
      sessionKey: " crewcmd:agent:hermes ",
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({
      "X-Hermes-Session-Key": "crewcmd:agent:hermes",
    });
  });

  it("does not override explicit Hermes session key headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new HermesApiAdapter();
    await adapter.executeTask("hello", {
      url: "http://localhost:8642",
      sessionKey: "config-key",
      headers: { "X-Hermes-Session-Key": "header-key" },
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({
      "X-Hermes-Session-Key": "header-key",
    });
  });

  it("rejects invalid Hermes session keys before sending", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new HermesApiAdapter();
    const result = await adapter.executeTask("hello", {
      url: "http://localhost:8642",
      sessionKey: "bad\nkey",
    });

    expect(result).toEqual({
      output: "Hermes request failed: Hermes sessionKey cannot contain control characters",
      exitCode: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns failed task output for non-2xx responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response("bad token", { status: 401 })) as typeof fetch;

    const adapter = new HermesApiAdapter();
    const result = await adapter.executeTask("hello", { url: "http://localhost:8642" });

    expect(result).toEqual({ output: "Hermes 401: bad token", exitCode: 1 });
  });
});
