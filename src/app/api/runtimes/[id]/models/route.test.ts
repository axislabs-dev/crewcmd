import { describe, expect, it, vi, beforeEach } from "vitest";

type RuntimeRow = {
  id: string;
  ownerUserId: string | null;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  metadata: Record<string, unknown> | null;
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
    runtimeType: { key: "runtimeType" },
    name: { key: "name" },
    gatewayUrl: { key: "gatewayUrl" },
    httpUrl: { key: "httpUrl" },
    authToken: { key: "authToken" },
    metadata: { key: "metadata" },
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

import { GET } from "./route";

describe("GET /api/runtimes/[id]/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
  });

  it("discovers runtime models in a stable credential-free shape", async () => {
    mockRuntimeRows.push({
      id: "rt_1",
      ownerUserId: "user_1",
      runtimeType: "openclaw",
      name: "OpenClaw",
      gatewayUrl: "ws://gateway",
      httpUrl: "http://gateway",
      authToken: null,
      metadata: null,
    });
    mockGetGatewayClientForRuntime.mockResolvedValue({
      listModels: () =>
        Promise.resolve({
          models: [
            {
              id: " claude-sonnet-4-5 ",
              name: "Claude Sonnet 4.5",
              provider: "anthropic",
              apiKey: "secret-key",
            },
          ],
        }),
    });

    const response = await GET(new Request("http://localhost/api/runtimes/rt_1/models"), {
      params: Promise.resolve({ id: "rt_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          runtimeId: "rt_1",
          provider: "anthropic",
          id: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
        },
      ],
    });
    expect(mockGetGatewayClientForRuntime).toHaveBeenCalledWith("rt_1");
  });

  it("does not call the gateway for unreadable runtimes", async () => {
    mockRuntimeRows.push({
      id: "rt_1",
      ownerUserId: "user_2",
      runtimeType: "openclaw",
      name: "OpenClaw",
      gatewayUrl: "ws://gateway",
      httpUrl: "http://gateway",
      authToken: null,
      metadata: null,
    });

    const response = await GET(new Request("http://localhost/api/runtimes/rt_1/models"), {
      params: Promise.resolve({ id: "rt_1" }),
    });

    expect(response.status).toBe(404);
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("discovers Hermes models without the OpenClaw gateway pool", async () => {
    mockRuntimeRows.push({
      id: "rt_hermes",
      ownerUserId: "user_1",
      runtimeType: "hermes",
      name: "Hermes",
      gatewayUrl: "http://localhost:8642",
      httpUrl: "http://localhost:8642",
      authToken: "secret",
      metadata: null,
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "hermes-agent", name: "Hermes Agent" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/models"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          runtimeId: "rt_hermes",
          provider: "hermes",
          id: "hermes-agent",
          name: "Hermes Agent",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/models", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
