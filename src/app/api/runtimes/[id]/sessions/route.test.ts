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
import { GET as getSessionMessages } from "./[sessionId]/messages/route";

function addRuntime(runtimeType = "hermes") {
  mockRuntimeRows.push({
    id: `rt_${runtimeType}`,
    ownerUserId: "user_1",
    runtimeType,
    name: runtimeType === "hermes" ? "Hermes" : "OpenClaw",
    gatewayUrl: runtimeType === "hermes" ? "http://localhost:8642" : "ws://gateway",
    httpUrl: runtimeType === "hermes" ? "http://localhost:8642" : "http://gateway",
    authToken: runtimeType === "hermes" ? "secret" : null,
    metadata: null,
  });
}

describe("runtime session endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRuntimeRows.length = 0;
  });

  it("lists Hermes sessions through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sessions: [{ id: "sess_1", title: "Main" }], total: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/runtimes/rt_hermes/sessions?limit=25&offset=5&source=crewcmd&includeChildren=true"),
      { params: Promise.resolve({ id: "rt_hermes" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessions: [{ id: "sess_1", title: "Main" }],
      raw: { sessions: [{ id: "sess_1", title: "Main" }], total: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8642/api/sessions?limit=25&offset=5&source=crewcmd&include_children=true",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer secret",
        },
      }
    );
  });

  it("reads Hermes session messages through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ role: "assistant", content: "Done." }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getSessionMessages(
      new Request("http://localhost/api/runtimes/rt_hermes/sessions/sess_1/messages"),
      { params: Promise.resolve({ id: "rt_hermes", sessionId: "sess_1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "sess_1",
      messages: [{ role: "assistant", content: "Done." }],
      raw: { messages: [{ role: "assistant", content: "Done." }] },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/sessions/sess_1/messages", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reports unsupported sessions for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await GET(new Request("http://localhost/api/runtimes/rt_openclaw/sessions"), {
      params: Promise.resolve({ id: "rt_openclaw" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime sessions",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
