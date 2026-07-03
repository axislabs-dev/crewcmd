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

import { POST } from "./route";
import { GET } from "./[runId]/route";
import { POST as approveRun } from "./[runId]/approval/route";
import { GET as getRunEvents } from "./[runId]/events/route";
import { POST as stopRun } from "./[runId]/stop/route";

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

describe("runtime run endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRuntimeRows.length = 0;
  });

  it("creates Hermes runs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run_id: "run_123", status: "started" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_hermes/runs", {
        method: "POST",
        body: JSON.stringify({
          input: "Do the work",
          sessionId: "chat-session",
          sessionKey: "crewcmd:agent:hermes",
          instructions: "Be concise",
        }),
      }),
      { params: Promise.resolve({ id: "rt_hermes" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: {
        runId: "run_123",
        status: "started",
        raw: { run_id: "run_123", status: "started" },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
        "X-Hermes-Session-Key": "crewcmd:agent:hermes",
      },
      body: JSON.stringify({
        input: "Do the work",
        session_id: "chat-session",
        instructions: "Be concise",
      }),
    });
  });

  it("returns Hermes run status through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        run_id: "run_123",
        status: "completed",
        session_id: "chat-session",
        output: "Done.",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/runs/run_123"), {
      params: Promise.resolve({ id: "rt_hermes", runId: "run_123" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        runId: "run_123",
        status: "completed",
        sessionId: "chat-session",
        output: "Done.",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reports unsupported run creation for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_openclaw/runs", {
        method: "POST",
        body: JSON.stringify({ input: "Do the work" }),
      }),
      { params: Promise.resolve({ id: "rt_openclaw" }) }
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime run creation",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("streams Hermes run events through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response("event: run.completed\ndata: {\"run_id\":\"run_123\"}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getRunEvents(
      new Request("http://localhost/api/runtimes/rt_hermes/runs/run_123/events", {
        headers: { "Last-Event-ID": "evt_1" },
      }),
      { params: Promise.resolve({ id: "rt_hermes", runId: "run_123" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    await expect(response.text()).resolves.toBe("event: run.completed\ndata: {\"run_id\":\"run_123\"}\n\n");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123/events", {
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer secret",
        "Last-Event-ID": "evt_1",
      },
    });
  });

  it("stops Hermes runs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "stopping" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await stopRun(new Request("http://localhost/api/runtimes/rt_hermes/runs/run_123/stop"), {
      params: Promise.resolve({ id: "rt_hermes", runId: "run_123" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: {
        runId: "run_123",
        status: "stopping",
        raw: { status: "stopping" },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/runs/run_123/stop", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("submits Hermes run approvals through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run_id: "run_123", status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await approveRun(
      new Request("http://localhost/api/runtimes/rt_hermes/runs/run_123/approval", {
        method: "POST",
        body: JSON.stringify({
          decision: "approved",
          approvalId: "approval_1",
          reason: "Allowed by operator",
          payload: { tool: "terminal" },
        }),
      }),
      { params: Promise.resolve({ id: "rt_hermes", runId: "run_123" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: {
        runId: "run_123",
        status: "running",
        raw: { run_id: "run_123", status: "running" },
      },
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

  it("reports unsupported run stop for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await stopRun(new Request("http://localhost/api/runtimes/rt_openclaw/runs/run_123/stop"), {
      params: Promise.resolve({ id: "rt_openclaw", runId: "run_123" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime run stop",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("reports unsupported run events for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await getRunEvents(
      new Request("http://localhost/api/runtimes/rt_openclaw/runs/run_123/events"),
      { params: Promise.resolve({ id: "rt_openclaw", runId: "run_123" }) }
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime run events",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
