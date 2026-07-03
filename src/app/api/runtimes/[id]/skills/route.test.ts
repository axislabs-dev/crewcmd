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

import { GET as getSkills } from "./route";
import { GET as getToolsets } from "../toolsets/route";

function addHermesRuntime() {
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
}

describe("runtime list discovery endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRuntimeRows.length = 0;
  });

  it("returns Hermes skills through the runtime provider", async () => {
    addHermesRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "repo", name: "Repository" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getSkills(new Request("http://localhost/api/runtimes/rt_hermes/skills"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skills: [{ id: "repo", name: "Repository" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/skills", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("returns Hermes toolsets through the runtime provider", async () => {
    addHermesRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: "code", name: "Code" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getToolsets(new Request("http://localhost/api/runtimes/rt_hermes/toolsets"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toolsets: [{ id: "code", name: "Code" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/toolsets", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("reports unsupported list discovery for OpenClaw runtimes", async () => {
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

    const response = await getSkills(new Request("http://localhost/api/runtimes/rt_openclaw/skills"), {
      params: Promise.resolve({ id: "rt_openclaw" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime skills discovery",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
