import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("GET /api/runtimes/[id]/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRuntimeRows.length = 0;
  });

  it("returns Hermes detailed health through the runtime provider", async () => {
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
      new Response(JSON.stringify({ status: "ready", components: { api: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/health"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      health: {
        ok: true,
        status: "ready",
        details: { status: "ready", components: { api: true } },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/health/detailed", {
      headers: { Accept: "application/json" },
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("falls back to Hermes basic health when detailed health is unavailable", async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/health"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      health: {
        ok: true,
        status: "ok",
        details: { status: "ok" },
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:8642/health/detailed", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:8642/v1/health/detailed", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://localhost:8642/health", {
      headers: { Accept: "application/json" },
    });
  });

  it("does not fetch health for unreadable runtimes", async () => {
    mockRuntimeRows.push({
      id: "rt_hermes",
      ownerUserId: "user_2",
      runtimeType: "hermes",
      name: "Hermes",
      gatewayUrl: "http://localhost:8642",
      httpUrl: "http://localhost:8642",
      authToken: "secret",
      metadata: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/health"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unsupported health discovery for OpenClaw runtimes", async () => {
    mockRuntimeRows.push({
      id: "rt_openclaw",
      ownerUserId: "user_1",
      runtimeType: "openclaw",
      name: "OpenClaw",
      gatewayUrl: "ws://gateway",
      httpUrl: "http://gateway",
      authToken: null,
      metadata: null,
    });

    const response = await GET(new Request("http://localhost/api/runtimes/rt_openclaw/health"), {
      params: Promise.resolve({ id: "rt_openclaw" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime health discovery",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
