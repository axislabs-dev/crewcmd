import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  ownerUserId: string | null;
};

type Field = { key: keyof RuntimeRow };
type Predicate = (row: RuntimeRow) => boolean;

const { mockRuntimeRows, mockGetGatewayClientForRuntime } = vi.hoisted(() => ({
  mockRuntimeRows: [] as RuntimeRow[],
  mockGetGatewayClientForRuntime: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: { key: "id" },
    ownerUserId: { key: "ownerUserId" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
  and: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.every((predicate) => predicate?.(row) ?? true),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => ({
          limit: (count: number) => Promise.resolve(mockRuntimeRows.filter(predicate).slice(0, count)),
        }),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  getAgentAccessContext: () => ({ userId: "user_1", activeCompanyId: null, memberships: [] }),
  buildRuntimeReadWhere: () => (row: RuntimeRow) => row.ownerUserId === "user_1",
}));

vi.mock("@/lib/gateway-chat-pool", () => ({
  getGatewayClientForRuntime: (...args: unknown[]) => mockGetGatewayClientForRuntime(...args),
}));

import { POST } from "./route";

describe("POST /api/runtimes/[id]/talk/realtime/relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
  });

  it("proxies realtime relay audio chunks through an accessible runtime", async () => {
    const realtimeRelayAudio = vi.fn().mockResolvedValue({ ok: true });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeRelayAudio });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "audio",
          relaySessionId: "relay_1",
          audioBase64: "AAAA",
          timestamp: 123,
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { ok: true } });
    expect(realtimeRelayAudio).toHaveBeenCalledWith({
      relaySessionId: "relay_1",
      audioBase64: "AAAA",
      timestamp: 123,
    });
  });

  it("proxies realtime output cancellation through an accessible runtime", async () => {
    const realtimeRelayCancelOutput = vi.fn().mockResolvedValue({ ok: true });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeRelayCancelOutput });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "cancelOutput",
          relaySessionId: "relay_1",
          reason: "barge-in",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { ok: true } });
    expect(realtimeRelayCancelOutput).toHaveBeenCalledWith("relay_1", "barge-in");
  });

  it("rejects invalid relay actions before calling the gateway", async () => {
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "unknown",
          relaySessionId: "relay_1",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(400);
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
