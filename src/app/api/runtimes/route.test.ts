import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type RuntimeRow = {
  id: string;
  companyId: string | null;
  ownerType: "user" | "company";
  ownerUserId: string | null;
  ownerCompanyId: string | null;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  isPrimary: boolean;
  status: string;
  lastPing: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type Field = { key: keyof RuntimeRow };
type Predicate = (row: RuntimeRow) => boolean;

const { mockAccess, mockRuntimeRows, mockResolveAccessibleWorkspace } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockRuntimeRows: [] as RuntimeRow[],
  mockResolveAccessibleWorkspace: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: { key: "id" },
    companyId: { key: "companyId" },
    ownerType: { key: "ownerType" },
    ownerUserId: { key: "ownerUserId" },
    ownerCompanyId: { key: "ownerCompanyId" },
    runtimeType: { key: "runtimeType" },
    name: { key: "name" },
    gatewayUrl: { key: "gatewayUrl" },
    httpUrl: { key: "httpUrl" },
    authToken: { key: "authToken" },
    isPrimary: { key: "isPrimary" },
    status: { key: "status" },
    lastPing: { key: "lastPing" },
    metadata: { key: "metadata" },
    createdAt: { key: "createdAt" },
    updatedAt: { key: "updatedAt" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
  isNull: (field: Field): Predicate => (row) => row[field.key] === null,
  and: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.every((predicate) => predicate?.(row) ?? true),
  or: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.some((predicate) => predicate?.(row) ?? false),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => Promise.resolve(mockRuntimeRows.filter(predicate)),
      }),
    }),
    insert: () => ({
      values: (values: Omit<RuntimeRow, "id">) => ({
        returning: () => {
          const runtime = {
            id: `rt_${mockRuntimeRows.length + 1}`,
            ...values,
          };
          mockRuntimeRows.push(runtime);
          return Promise.resolve([runtime]);
        },
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  getAgentAccessContext: () => mockAccess(),
  buildRuntimeReadWhere: () => undefined,
  canManageCompanyOwnedAgent: () => true,
  runtimeOwnershipValues: (params: {
    ownerType?: string | null;
    userId: string | null;
    activeCompanyId?: string | null;
  }) => {
    const ownerType = params.ownerType === "company" ? "company" : "user";
    if (ownerType === "company") {
      if (!params.activeCompanyId) throw new Error("Company-owned runtimes require a company workspace");
      return {
        ownerType,
        ownerUserId: null,
        ownerCompanyId: params.activeCompanyId,
        companyId: params.activeCompanyId,
      };
    }

    return {
      ownerType,
      ownerUserId: params.userId,
      ownerCompanyId: null,
      companyId: params.activeCompanyId ?? null,
    };
  },
}));

vi.mock("@/lib/runtime-callback-url", () => ({
  getRequestOrigin: () => "http://localhost:3000",
}));

vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: vi.fn(async () => null),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/runtimes"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function runtimeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Local OpenClaw",
    gatewayUrl: "ws://localhost:18789",
    httpUrl: "http://localhost:18789",
    ...overrides,
  };
}

async function createRuntime(userId: string, body: Record<string, unknown> = {}) {
  mockAccess.mockResolvedValue({
    userId,
    activeCompanyId: "co_1",
    memberships: [{ companyId: "co_1", role: "admin" }],
  });

  const response = await POST(makeRequest(runtimeBody(body)));
  expect(response.status).toBe(200);
  return response.json() as Promise<RuntimeRow>;
}

describe("POST /api/runtimes primary scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
    mockResolveAccessibleWorkspace.mockResolvedValue({
      id: "ws_co_1",
      type: "company",
      companyId: "co_1",
    });
  });

  it("marks user A's first personal runtime as primary", async () => {
    const runtime = await createRuntime("user_a");

    expect(runtime).toMatchObject({
      ownerType: "user",
      ownerUserId: "user_a",
      companyId: "co_1",
      isPrimary: true,
    });
  });

  it("marks user B's first personal runtime in the same company as primary for user B", async () => {
    await createRuntime("user_a");

    const runtime = await createRuntime("user_b");

    expect(runtime).toMatchObject({
      ownerType: "user",
      ownerUserId: "user_b",
      companyId: "co_1",
      isPrimary: true,
    });
  });

  it("does not mark a second personal runtime for the same user as primary", async () => {
    await createRuntime("user_a");

    const runtime = await createRuntime("user_a", {
      name: "Second OpenClaw",
      gatewayUrl: "ws://localhost:28789",
      httpUrl: "http://localhost:28789",
    });

    expect(runtime).toMatchObject({
      ownerType: "user",
      ownerUserId: "user_a",
      isPrimary: false,
    });
  });

  it("keeps company runtime primary behavior scoped to the company owner", async () => {
    const first = await createRuntime("admin_a", {
      ownerType: "company",
      name: "Company OpenClaw",
    });
    const second = await createRuntime("admin_b", {
      ownerType: "company",
      name: "Company OpenClaw 2",
      gatewayUrl: "ws://localhost:28789",
      httpUrl: "http://localhost:28789",
    });

    expect(first).toMatchObject({
      ownerType: "company",
      ownerCompanyId: "co_1",
      isPrimary: true,
    });
    expect(second).toMatchObject({
      ownerType: "company",
      ownerCompanyId: "co_1",
      isPrimary: false,
    });
  });
});
