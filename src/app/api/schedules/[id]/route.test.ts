import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type RuntimeRow = {
  id: string;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  metadata: Record<string, unknown> | null;
};

const {
  mockState,
  mockPauseJob,
  mockResumeJob,
  mockListCronJobsFromRuntime,
  mockUpdate,
  mockSet,
  mockWhere,
  mockGatewayConnect,
  mockGatewayCronUpdate,
  mockGatewayClose,
} = vi.hoisted(() => ({
  mockState: {
    runtime: {
      id: "rt_hermes",
      runtimeType: "hermes",
      name: "Hermes",
      gatewayUrl: "http://localhost:8642",
      httpUrl: "http://localhost:8642",
      authToken: "secret",
      metadata: null,
    } as RuntimeRow | null,
  },
  mockPauseJob: vi.fn(),
  mockResumeJob: vi.fn(),
  mockListCronJobsFromRuntime: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockGatewayConnect: vi.fn(),
  mockGatewayCronUpdate: vi.fn(),
  mockGatewayClose: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: () => null,
}));

vi.mock("@/db/schema", () => ({
  cronJobs: {
    id: { key: "id" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: unknown, value: unknown) => ({ field, value }),
}));

vi.mock("@/db", () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/runtime-cron-sync", () => ({
  resolvePrimaryReadableRuntimeForActiveWorkspace: () => mockState.runtime,
  listCronJobsFromRuntime: (...args: unknown[]) => mockListCronJobsFromRuntime(...args),
}));

vi.mock("@/lib/gateway-client", () => ({
  resolveDeviceIdentity: () => null,
  GatewayClient: vi.fn(function GatewayClient() {
    return {
      connect: mockGatewayConnect,
      cronUpdate: mockGatewayCronUpdate,
      close: mockGatewayClose,
    };
  }),
}));

vi.mock("@/lib/runtimes/providers", () => ({
  getRuntimeProvider: () => ({
    displayName: "Hermes Agent API",
    pauseJob: (...args: unknown[]) => mockPauseJob(...args),
    resumeJob: (...args: unknown[]) => mockResumeJob(...args),
  }),
}));

import { PATCH } from "./route";

describe("PATCH /api/schedules/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runtime = {
      id: "rt_hermes",
      runtimeType: "hermes",
      name: "Hermes",
      gatewayUrl: "http://localhost:8642",
      httpUrl: "http://localhost:8642",
      authToken: "secret",
      metadata: null,
    };
    mockPauseJob.mockResolvedValue({ jobId: "job_1", status: "paused", runId: null, raw: { status: "paused" } });
    mockResumeJob.mockResolvedValue({ jobId: "job_1", status: "resumed", runId: null, raw: { status: "resumed" } });
    mockWhere.mockResolvedValue({ rowCount: 1 });
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  it("pauses Hermes jobs when a schedule is disabled", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/schedules/job_1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ id: "job_1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "job_1",
      enabled: false,
      runtimeId: "rt_hermes",
      status: "paused",
      raw: { status: "paused" },
    });
    expect(mockPauseJob).toHaveBeenCalledWith(mockState.runtime, "job_1");
    expect(mockResumeJob).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(mockListCronJobsFromRuntime).not.toHaveBeenCalled();
  });

  it("resumes Hermes jobs when a schedule is enabled", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/schedules/job_1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ id: "job_1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "job_1",
      enabled: true,
      runtimeId: "rt_hermes",
      status: "resumed",
    });
    expect(mockResumeJob).toHaveBeenCalledWith(mockState.runtime, "job_1");
    expect(mockPauseJob).not.toHaveBeenCalled();
  });

  it("preserves the OpenClaw cron update path", async () => {
    mockState.runtime = {
      id: "rt_openclaw",
      runtimeType: "openclaw",
      name: "OpenClaw",
      gatewayUrl: "ws://gateway",
      httpUrl: "http://gateway",
      authToken: null,
      metadata: null,
    };
    mockListCronJobsFromRuntime.mockResolvedValue({
      runtime: mockState.runtime,
      jobs: [{ id: "job_1", name: "Job", enabled: true, schedule: {}, payload: {} }],
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/schedules/job_1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ id: "job_1" }) }
    );

    expect(response.status).toBe(200);
    expect(mockGatewayConnect).toHaveBeenCalled();
    expect(mockGatewayCronUpdate).toHaveBeenCalledWith({ id: "job_1", patch: { enabled: false } });
    expect(mockGatewayClose).toHaveBeenCalled();
  });
});
