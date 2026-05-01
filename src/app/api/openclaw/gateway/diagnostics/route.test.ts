import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  gatewayUrl: string;
  authToken: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  status: string;
  lastPing: Date | null;
  updatedAt: Date | null;
};

const { mockAccess, mockRuntimeRows } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockRuntimeRows: [] as RuntimeRow[],
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: { key: "id" },
    gatewayUrl: { key: "gatewayUrl" },
    authToken: { key: "authToken" },
    metadata: { key: "metadata" },
    isPrimary: { key: "isPrimary" },
    status: { key: "status" },
    lastPing: { key: "lastPing" },
    updatedAt: { key: "updatedAt" },
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRuntimeRows),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  getAgentAccessContext: () => mockAccess(),
  buildRuntimeReadWhere: () => ({}),
}));

import { classifyGatewayFailure, resetGatewayPoolForTests } from "@/lib/gateway-chat-pool";
import { GET } from "./route";

describe("GET /api/openclaw/gateway/diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
    resetGatewayPoolForTests();
  });

  it("returns redacted gateway runtime and pool diagnostics", async () => {
    mockAccess.mockResolvedValue({ userId: "user_1" });
    mockRuntimeRows.push({
      id: "runtime-1",
      gatewayUrl: "ws://user:pass@localhost:18789/path?token=secret#frag",
      authToken: "gateway-token",
      metadata: {
        workspaceId: "workspace-1",
        devicePrivateKeyPem: "private-key",
        nested: { apiSecret: "secret", safe: "value" },
      },
      isPrimary: true,
      status: "connected",
      lastPing: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:01:00.000Z"),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pool).toMatchObject({
      poolSize: 0,
      activeClients: 0,
      activeHolds: 0,
    });
    expect(body.runtimes).toHaveLength(1);
    expect(body.runtimes[0]).toMatchObject({
      id: "runtime-1",
      gatewayUrl: "ws://localhost:18789/path",
      hasAuthToken: true,
      isPrimary: true,
      status: "connected",
      lastPing: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
      metadata: {
        workspaceId: "workspace-1",
        devicePrivateKeyPem: "[redacted]",
        nested: { apiSecret: "[redacted]", safe: "value" },
      },
      pool: {
        connected: false,
        ageMs: null,
        held: false,
        holds: 0,
      },
      lastConnection: null,
    });
    expect(JSON.stringify(body)).not.toContain("gateway-token");
    expect(JSON.stringify(body)).not.toContain("private-key");
  });

  it("requires authentication", async () => {
    mockAccess.mockResolvedValue({ userId: null });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("classifies narrow gateway failure categories", () => {
    expect(classifyGatewayFailure(new Error("Runtime has no gateway URL configured"))).toBe("configuration");
    expect(classifyGatewayFailure(new Error("pairing_required"))).toBe("pairing_required");
    expect(classifyGatewayFailure(new Error("Unauthorized gateway token"))).toBe("authentication");
    expect(classifyGatewayFailure(new Error("connect ETIMEDOUT"))).toBe("timeout");
    expect(classifyGatewayFailure(new Error("connect ECONNREFUSED 127.0.0.1"))).toBe("network");
  });
});
