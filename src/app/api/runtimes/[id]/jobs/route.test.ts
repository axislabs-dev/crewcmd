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

import { GET, POST } from "./route";
import { GET as getJob, PATCH as updateJob } from "./[jobId]/route";
import { POST as pauseJob } from "./[jobId]/pause/route";
import { POST as resumeJob } from "./[jobId]/resume/route";
import { POST as runJobNow } from "./[jobId]/run/route";

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

describe("runtime job endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRuntimeRows.length = 0;
  });

  it("lists Hermes jobs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jobs: [{ id: "job_1", prompt: "Check status" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/runtimes/rt_hermes/jobs"), {
      params: Promise.resolve({ id: "rt_hermes" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [{ id: "job_1", prompt: "Check status" }],
      raw: { jobs: [{ id: "job_1", prompt: "Check status" }] },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reads Hermes job detail through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job: { id: "job_1", prompt: "Check status" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getJob(new Request("http://localhost/api/runtimes/rt_hermes/jobs/job_1"), {
      params: Promise.resolve({ id: "rt_hermes", jobId: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      job: { id: "job_1", prompt: "Check status" },
      raw: { job: { id: "job_1", prompt: "Check status" } },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs/job_1", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reports unsupported jobs for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await GET(new Request("http://localhost/api/runtimes/rt_openclaw/jobs"), {
      params: Promise.resolve({ id: "rt_openclaw" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime jobs",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("creates Hermes jobs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job: { id: "job_1", prompt: "Check status" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_hermes/jobs", {
        method: "POST",
        body: JSON.stringify({ prompt: "Check status", schedule: "*/15 * * * *", skills: ["status"] }),
      }),
      { params: Promise.resolve({ id: "rt_hermes" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      job: { id: "job_1", prompt: "Check status" },
      raw: { job: { id: "job_1", prompt: "Check status" } },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "Check status", schedule: "*/15 * * * *", skills: ["status"] }),
    });
  });

  it("updates Hermes jobs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job: { id: "job_1", prompt: "Check status", paused: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await updateJob(
      new Request("http://localhost/api/runtimes/rt_hermes/jobs/job_1", {
        method: "PATCH",
        body: JSON.stringify({ prompt: "Check status", paused: false }),
      }),
      { params: Promise.resolve({ id: "rt_hermes", jobId: "job_1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      job: { id: "job_1", prompt: "Check status", paused: false },
      raw: { job: { id: "job_1", prompt: "Check status", paused: false } },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs/job_1", {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "Check status", paused: false }),
    });
  });

  it("reports unsupported job creation for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_openclaw/jobs", {
        method: "POST",
        body: JSON.stringify({ prompt: "Check status" }),
      }),
      { params: Promise.resolve({ id: "rt_openclaw" }) }
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime job creation",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("pauses Hermes jobs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job_id: "job_1", status: "paused" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await pauseJob(new Request("http://localhost/api/runtimes/rt_hermes/jobs/job_1/pause"), {
      params: Promise.resolve({ id: "rt_hermes", jobId: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      status: "paused",
      runId: null,
      raw: { job_id: "job_1", status: "paused" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs/job_1/pause", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("resumes Hermes jobs through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job_id: "job_1", status: "resumed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await resumeJob(new Request("http://localhost/api/runtimes/rt_hermes/jobs/job_1/resume"), {
      params: Promise.resolve({ id: "rt_hermes", jobId: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      status: "resumed",
      runId: null,
      raw: { job_id: "job_1", status: "resumed" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs/job_1/resume", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reports unsupported job pause for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await pauseJob(new Request("http://localhost/api/runtimes/rt_openclaw/jobs/job_1/pause"), {
      params: Promise.resolve({ id: "rt_openclaw", jobId: "job_1" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime job pause",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("runs Hermes jobs immediately through the runtime provider", async () => {
    addRuntime();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job_id: "job_1", run_id: "run_1", status: "started" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await runJobNow(new Request("http://localhost/api/runtimes/rt_hermes/jobs/job_1/run"), {
      params: Promise.resolve({ id: "rt_hermes", jobId: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job_1",
      status: "started",
      runId: "run_1",
      raw: { job_id: "job_1", run_id: "run_1", status: "started" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/api/jobs/job_1/run", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
  });

  it("reports unsupported job run-now for OpenClaw runtimes", async () => {
    addRuntime("openclaw");

    const response = await runJobNow(new Request("http://localhost/api/runtimes/rt_openclaw/jobs/job_1/run"), {
      params: Promise.resolve({ id: "rt_openclaw", jobId: "job_1" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway does not support runtime job run-now",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
