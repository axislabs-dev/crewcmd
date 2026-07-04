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

const { mockState, mockRunJobNow } = vi.hoisted(() => ({
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
  mockRunJobNow: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: () => null,
}));

vi.mock("@/lib/runtime-cron-sync", () => ({
  resolvePrimaryReadableRuntimeForActiveWorkspace: () => mockState.runtime,
}));

vi.mock("@/lib/runtimes/providers", () => ({
  getRuntimeProvider: (runtimeType: string) =>
    runtimeType === "hermes"
      ? {
          displayName: "Hermes Agent API",
          runJobNow: (...args: unknown[]) => mockRunJobNow(...args),
        }
      : {
          displayName: "OpenClaw Gateway",
        },
}));

import { POST } from "./route";

describe("POST /api/schedules/[id]/run", () => {
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
    mockRunJobNow.mockResolvedValue({
      jobId: "job_1",
      status: "started",
      runId: "run_1",
      raw: { job_id: "job_1", run_id: "run_1", status: "started" },
    });
  });

  it("runs Hermes jobs through the active runtime provider", async () => {
    const response = await POST(new NextRequest("http://localhost/api/schedules/job_1/run", { method: "POST" }), {
      params: Promise.resolve({ id: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "job_1",
      runtimeId: "rt_hermes",
      status: "started",
      runId: "run_1",
      raw: { job_id: "job_1", run_id: "run_1", status: "started" },
    });
    expect(mockRunJobNow).toHaveBeenCalledWith(mockState.runtime, "job_1");
  });

  it("reports unsupported run-now for OpenClaw schedules", async () => {
    mockState.runtime = {
      id: "rt_openclaw",
      runtimeType: "openclaw",
      name: "OpenClaw",
      gatewayUrl: "ws://gateway",
      httpUrl: "http://gateway",
      authToken: null,
      metadata: null,
    };

    const response = await POST(new NextRequest("http://localhost/api/schedules/job_1/run", { method: "POST" }), {
      params: Promise.resolve({ id: "job_1" }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "OpenClaw Gateway schedule run-now is not supported yet",
    });
    expect(mockRunJobNow).not.toHaveBeenCalled();
  });

  it("reports missing active runtimes", async () => {
    mockState.runtime = null;

    const response = await POST(new NextRequest("http://localhost/api/schedules/job_1/run", { method: "POST" }), {
      params: Promise.resolve({ id: "job_1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No connected runtime found",
    });
  });
});
