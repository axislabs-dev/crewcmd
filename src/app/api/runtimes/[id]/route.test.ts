import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type RuntimeRow = {
  id: string;
  companyId: string | null;
  ownerType: "user" | "company";
  ownerUserId: string | null;
  ownerCompanyId: string | null;
  isPrimary: boolean;
  runtimeType: string;
  gatewayUrl: string;
  metadata: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  cleanup: vi.fn(),
  deleteManagedResources: vi.fn(),
  listManagedResources: vi.fn(),
  probeGateway: vi.fn(),
  sealDeviceKey: vi.fn((_value: string) => "sealed-device-key"),
  storeDeviceAuth: vi.fn((
    metadata: Record<string, unknown>,
    _deviceId: string,
    _deviceAuth: unknown,
  ) => ({
    ...metadata,
    openclawDeviceAuth: { stored: true },
  })),
  sealAuthToken: vi.fn((value: string) => `sealed-token:${value}`),
  deletedTables: [] as string[],
  updatedTables: [] as string[],
  updatedValues: [] as Record<string, unknown>[],
  runtime: {
    id: "runtime-1",
    companyId: null,
    ownerType: "user",
    ownerUserId: "user-1",
    ownerCompanyId: null,
    isPrimary: false,
    runtimeType: "openclaw",
    gatewayUrl: "ws://localhost:18789",
    metadata: {
      devicePrivateKeyPem: "sealed-existing-key",
      retained: true,
    },
  } as RuntimeRow,
}));

vi.mock("@/db/schema", () => ({
  agents: { table: "agents", id: "agents.id", runtimeId: "agents.runtimeId" },
  companyRuntimes: {
    table: "companyRuntimes",
    id: "companyRuntimes.id",
    companyId: "companyRuntimes.companyId",
    ownerType: "companyRuntimes.ownerType",
    ownerUserId: "companyRuntimes.ownerUserId",
    ownerCompanyId: "companyRuntimes.ownerCompanyId",
    isPrimary: "companyRuntimes.isPrimary",
    authToken: "companyRuntimes.authToken",
    metadata: "companyRuntimes.metadata",
    status: "companyRuntimes.status",
    lastPing: "companyRuntimes.lastPing",
    updatedAt: "companyRuntimes.updatedAt",
  },
  cronJobs: { table: "cronJobs", id: "cronJobs.id" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  isNull: vi.fn((field: unknown) => ({ field, value: null })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: { table: string }) => ({
        where: () => table.table === "companyRuntimes"
          ? { limit: async () => [mocks.runtime] }
          : Promise.resolve([{ id: "agent-1" }]),
      }),
    }),
    update: (table: { table: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.updatedTables.push(table.table);
          mocks.updatedValues.push(values);
        },
      }),
    }),
    delete: (table: { table: string }) => ({
      where: async () => {
        mocks.deletedTables.push(table.table);
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  canManageCompanyOwnedAgent: vi.fn(() => false),
  getAgentAccessContext: () => mocks.access(),
}));

vi.mock("@/lib/runtime-operating-layer", () => ({
  cleanupCrewCmdRuntimeOperatingLayer: (...args: unknown[]) => mocks.cleanup(...args),
}));

vi.mock("@/lib/runtime-managed-resources", () => ({
  deleteRuntimeManagedResources: (...args: unknown[]) => mocks.deleteManagedResources(...args),
  listRuntimeManagedResources: (...args: unknown[]) => mocks.listManagedResources(...args),
}));

vi.mock("@/lib/runtime-api-dto", () => ({
  toBrowserSafeRuntime: (runtime: unknown) => runtime,
}));

vi.mock("@/lib/gateway-client", () => ({
  probeGateway: (...args: unknown[]) => mocks.probeGateway(...args),
  resolveDeviceIdentity: () => ({ deviceId: "device-1" }),
}));

vi.mock("@/lib/runtime-device-auth", () => ({
  sealRuntimeDevicePrivateKey: (value: string) => mocks.sealDeviceKey(value),
  storeRuntimeDeviceAuth: (
    metadata: Record<string, unknown>,
    deviceId: string,
    deviceAuth: unknown,
  ) => mocks.storeDeviceAuth(metadata, deviceId, deviceAuth),
}));

vi.mock("@/lib/runtime-token-crypto", () => ({
  isEncryptedRuntimeAuthToken: (value: string) => value.startsWith("sealed-"),
  sealRuntimeAuthToken: (value: string) => mocks.sealAuthToken(value),
}));

import { DELETE, PATCH } from "./route";

function makeRequest(cleanup?: string) {
  const url = new URL("http://localhost/api/runtimes/runtime-1");
  if (cleanup) url.searchParams.set("cleanup", cleanup);
  return new NextRequest(url, { method: "DELETE" });
}

function makeReauthenticateRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/runtimes/runtime-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ id: "runtime-1" }) };
}

describe("DELETE /api/runtimes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletedTables.length = 0;
    mocks.updatedTables.length = 0;
    mocks.updatedValues.length = 0;
    mocks.access.mockResolvedValue({ userId: "user-1" });
    mocks.listManagedResources.mockResolvedValue([
      { resourceType: "agent-skill", externalId: null },
      { resourceType: "cron-job", externalId: null },
    ]);
  });

  it("offers a local fallback when remote cleanup fails", async () => {
    mocks.cleanup.mockRejectedValue(new Error("pairing required"));

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNTIME_CLEANUP_FAILED",
      canSkipCleanup: true,
      linkedAgents: 1,
      managedResources: 2,
    });
    expect(mocks.deleteManagedResources).not.toHaveBeenCalled();
    expect(mocks.updatedTables).toEqual([]);
    expect(mocks.deletedTables).toEqual([]);
  });

  it("forgets locally while preserving runtime agent identity", async () => {
    const response = await DELETE(makeRequest("skip"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      detachedAgents: 1,
      cleanupSkipped: true,
    });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deleteManagedResources).toHaveBeenCalledWith("runtime-1");
    expect(mocks.updatedTables).toEqual(["agents"]);
    expect(mocks.updatedValues).toEqual([{ runtimeId: null, status: "offline" }]);
    expect(mocks.deletedTables).toEqual(["companyRuntimes"]);
  });

  it("rejects unsupported cleanup modes", async () => {
    const response = await DELETE(makeRequest("force"), context());

    expect(response.status).toBe(400);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deleteManagedResources).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/runtimes/[id] reauthenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedTables.length = 0;
    mocks.updatedValues.length = 0;
    mocks.access.mockResolvedValue({ userId: "user-1" });
    mocks.runtime.ownerType = "user";
    mocks.runtime.ownerUserId = "user-1";
    mocks.runtime.runtimeType = "openclaw";
    mocks.runtime.gatewayUrl = "ws://localhost:18789";
    mocks.runtime.metadata = {
      devicePrivateKeyPem: "sealed-existing-key",
      retained: true,
    };
  });

  it("verifies the replacement before atomically storing it", async () => {
    mocks.probeGateway.mockResolvedValue({
      ok: true,
      agents: [],
      models: [],
      devicePrivateKeyPem: "raw-private-key",
    });

    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "new-token",
    }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      authenticationMode: "local-shared-token",
    });
    expect(mocks.probeGateway).toHaveBeenCalledWith(
      "ws://localhost:18789",
      "new-token",
      "sealed-existing-key",
    );
    expect(mocks.updatedTables).toEqual(["companyRuntimes"]);
    expect(mocks.updatedValues).toHaveLength(1);
    expect(mocks.updatedValues[0]).toMatchObject({
      authToken: "sealed-token:new-token",
      metadata: {
        devicePrivateKeyPem: "sealed-device-key",
        retained: true,
      },
      status: "connected",
    });
  });

  it("retains the approved device token returned by a paired gateway", async () => {
    const deviceAuth = {
      token: "device-token",
      role: "operator",
      scopes: ["operator.admin"],
    };
    mocks.probeGateway.mockResolvedValue({
      ok: true,
      agents: [],
      models: [],
      devicePrivateKeyPem: "raw-private-key",
      deviceAuth,
    });

    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "new-token",
    }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticationMode: "paired-device",
    });
    expect(mocks.storeDeviceAuth).toHaveBeenCalledWith(
      expect.objectContaining({ devicePrivateKeyPem: "sealed-device-key" }),
      "device-1",
      deviceAuth,
    );
    expect(mocks.updatedValues[0]).toMatchObject({
      metadata: { openclawDeviceAuth: { stored: true } },
    });
  });

  it("keeps the stored credential unchanged when verification fails", async () => {
    mocks.probeGateway.mockResolvedValue({
      ok: false,
      error: "unauthorized: gateway token mismatch",
      agents: [],
      models: [],
    });

    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "wrong-token",
    }), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNTIME_REAUTHENTICATION_FAILED",
    });
    expect(mocks.updatedTables).toEqual([]);
    expect(mocks.sealAuthToken).not.toHaveBeenCalled();
  });

  it("returns only a sealed identity for a pairing retry", async () => {
    mocks.runtime.metadata = { retained: true };
    mocks.probeGateway.mockResolvedValue({
      ok: false,
      error: "pairing_required",
      pairingInstructions: "Approve the pending request",
      agents: [],
      models: [],
      devicePrivateKeyPem: "raw-pending-private-key",
    });

    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "new-token",
    }), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "PAIRING_REQUIRED",
      pairingRequired: true,
      deviceKeyPem: "sealed-device-key",
    });
    expect(JSON.stringify(body)).not.toContain("raw-pending-private-key");
    expect(mocks.updatedTables).toEqual([]);
  });

  it("rejects a browser-supplied plaintext device key", async () => {
    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "new-token",
      deviceKeyPem: "-----BEGIN PRIVATE KEY-----",
    }), context());

    expect(response.status).toBe(400);
    expect(mocks.probeGateway).not.toHaveBeenCalled();
    expect(mocks.updatedTables).toEqual([]);
  });

  it("does not probe a runtime owned by another user", async () => {
    mocks.runtime.ownerUserId = "user-2";

    const response = await PATCH(makeReauthenticateRequest({
      action: "reauthenticate",
      authToken: "new-token",
    }), context());

    expect(response.status).toBe(403);
    expect(mocks.probeGateway).not.toHaveBeenCalled();
    expect(mocks.updatedTables).toEqual([]);
  });
});
