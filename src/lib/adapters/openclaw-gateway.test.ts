import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenClawGatewayAdapter } from "./openclaw-gateway";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OpenClawGatewayAdapter", () => {
  it("adds a final-response system instruction to gateway requests", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new OpenClawGatewayAdapter();
    const result = await adapter.executeTask("Do the work", {
      url: "http://gateway.local",
      model: "openclaw",
    });

    expect(result).toEqual({ output: "done", exitCode: 0 });
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("Always produce a final text response");
    expect(body.messages[1]).toEqual({ role: "user", content: "Do the work" });
  });

  it("treats OpenClaw no-response sentinel output as a failed task", async () => {
    const warning = "⚠️ Agent couldn't generate a response. Note: some tool actions may have already been executed — please verify before retrying.";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: warning } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as typeof fetch;

    const adapter = new OpenClawGatewayAdapter();
    const result = await adapter.executeTask("complex task", { url: "http://gateway.local" });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OpenClaw Gateway returned no final agent response");
    expect(result.output).toContain("Some tool actions may have already executed");
  });
});
