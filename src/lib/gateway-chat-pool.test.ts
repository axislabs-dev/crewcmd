import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "./gateway-client";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    runtimes: new Map<string, unknown>(),
    clients: [] as Array<{ url: string; isConnected: boolean; close: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }>,
  },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      companyRuntimes: {
        findFirst: vi.fn(async ({ where }: { where?: { right?: unknown } } = {}) => {
          if (where?.right === true) {
            return [...mockState.runtimes.values()].find((runtime) => {
              return (runtime as { isPrimary?: boolean }).isPrimary;
            }) ?? null;
          }

          if (typeof where?.right === "string") {
            return mockState.runtimes.get(where.right) ?? null;
          }

          return null;
        }),
      },
    },
  },
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: Symbol.for("companyRuntimes.id"),
    isPrimary: Symbol.for("companyRuntimes.isPrimary"),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("./gateway-client", () => {
  class MockGatewayClient {
    url: string;
    isConnected = false;
    close = vi.fn(() => {
      this.isConnected = false;
    });
    connect = vi.fn(async () => {
      this.isConnected = true;
    });

    constructor(url: string) {
      this.url = url;
      mockState.clients.push(this);
    }
  }

  return {
    GatewayClient: MockGatewayClient,
    resolveDeviceIdentity: vi.fn(() => ({
      deviceId: "device-1",
      publicKeyRawBase64Url: "public-key",
      privateKeyPem: "private-key",
      source: "configured",
    })),
  };
});

import {
  getGatewayClientForRuntime,
  getGatewayPoolDiagnostics,
  holdClient,
  releaseClient,
  resetGatewayPoolForTests,
} from "./gateway-chat-pool";

function addRuntime(id: string, overrides: Record<string, unknown> = {}) {
  mockState.runtimes.set(id, {
    id,
    gatewayUrl: `ws://127.0.0.1/${id}`,
    authToken: null,
    metadata: null,
    isPrimary: false,
    ...overrides,
  });
}

describe("gateway-chat-pool active client holds", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockState.runtimes.clear();
    mockState.clients.length = 0;
  });

  afterEach(() => {
    resetGatewayPoolForTests();
    vi.useRealTimers();
  });

  it("keeps a client active until every holder releases it", () => {
    const client = { close() {} } as GatewayClient;

    holdClient(client);
    holdClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 1,
      activeHolds: 2,
    });

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 1,
      activeHolds: 1,
    });

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 0,
      activeHolds: 0,
    });
  });

  it("ignores extra releases after a client is no longer held", () => {
    const client = { close() {} } as GatewayClient;

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 0,
      activeHolds: 0,
    });
  });
});

describe("getGatewayClientForRuntime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockState.runtimes.clear();
    mockState.clients.length = 0;
  });

  afterEach(() => {
    resetGatewayPoolForTests();
    vi.useRealTimers();
  });

  it("reuses clients within the requested runtime scope", async () => {
    addRuntime("runtime-a");
    addRuntime("runtime-b");

    const firstRuntimeA = await getGatewayClientForRuntime("runtime-a");
    const runtimeB = await getGatewayClientForRuntime("runtime-b");
    const secondRuntimeA = await getGatewayClientForRuntime("runtime-a");

    expect(secondRuntimeA).toBe(firstRuntimeA);
    expect(runtimeB).not.toBe(firstRuntimeA);
    expect(mockState.clients).toHaveLength(2);
    expect(getGatewayPoolDiagnostics()).toMatchObject({ poolSize: 2 });
  });

  it("fails when the requested runtime is missing", async () => {
    await expect(getGatewayClientForRuntime("missing-runtime")).rejects.toThrow(
      "Runtime not found: missing-runtime",
    );
  });

  it("recycles stale clients for the same runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    addRuntime("runtime-a");

    const staleClient = await getGatewayClientForRuntime("runtime-a");

    vi.setSystemTime(new Date("2026-05-01T00:05:01.000Z"));

    const freshClient = await getGatewayClientForRuntime("runtime-a");

    expect(freshClient).not.toBe(staleClient);
    expect(mockState.clients).toHaveLength(2);
    expect(mockState.clients[0].close).toHaveBeenCalledTimes(1);
    expect(getGatewayPoolDiagnostics()).toMatchObject({ poolSize: 1 });
  });
});
