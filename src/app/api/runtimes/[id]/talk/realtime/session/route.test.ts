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

describe("POST /api/runtimes/[id]/talk/realtime/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
  });

  it("proxies realtime talk session requests through an accessible runtime", async () => {
    const realtimeTalkSession = vi.fn().mockResolvedValue({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: " main ",
          provider: "openai",
          model: "gpt-realtime-1.5",
          voice: "marin",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: {
        transport: "gateway-relay",
        relaySessionId: "relay_1",
      },
    });
    expect(realtimeTalkSession).toHaveBeenCalledWith({
      sessionKey: "main",
      provider: "openai",
      model: "gpt-realtime-1.5",
      voice: "marin",
      agentId: undefined,
    });
  });

  it("does not call the gateway for unreadable runtimes", async () => {
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_2" });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", { method: "POST" }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(404);
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
