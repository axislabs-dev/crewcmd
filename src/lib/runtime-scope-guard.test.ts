import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyViolation } from "./collaboration-policy";

const mockFindRuntime = vi.fn();
const mockFindWorkspace = vi.fn();
const mockLogAudit = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: {
      companyRuntimes: { findFirst: (...args: unknown[]) => mockFindRuntime(...args) },
      workspaces: { findFirst: (...args: unknown[]) => mockFindWorkspace(...args) },
    },
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/governance", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

import {
  assertPrimaryRuntimeInvocationAllowedForContext,
  assertRuntimeInvocationAllowedForContext,
} from "./runtime-scope-guard";

const sharedRuntime = {
  id: "runtime-shared",
  companyId: "company-1",
  ownerType: "company" as const,
  ownerUserId: null,
  ownerCompanyId: "company-1",
  runtimeType: "openclaw",
  name: "Team OpenClaw",
  gatewayUrl: "ws://localhost:18789",
  httpUrl: "http://localhost:18789",
  authToken: null,
  isPrimary: true,
  status: "connected",
  lastPing: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const personalRuntime = {
  ...sharedRuntime,
  id: "runtime-personal",
  companyId: null,
  ownerType: "user" as const,
  ownerUserId: "user-1",
  ownerCompanyId: null,
  name: "Personal OpenClaw",
};

describe("runtime scope guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRuntime.mockResolvedValue(sharedRuntime);
    mockFindWorkspace.mockResolvedValue(null);
    mockLogAudit.mockResolvedValue(null);
  });

  it("rejects personal runtime invocation from company shared context and audits it", async () => {
    await expect(assertRuntimeInvocationAllowedForContext(personalRuntime, {
      companyId: "company-1",
      userId: "user-1",
      actor: "user@example.com",
    })).rejects.toBeInstanceOf(PolicyViolation);

    expect(mockLogAudit).toHaveBeenCalledWith(
      "company-1",
      "user@example.com",
      "runtime_invocation_rejected",
      "company_runtime",
      "runtime-personal",
      expect.objectContaining({
        runtimeClass: "personal",
        runtimeOwnerUserId: "user-1",
        scopeId: "company-1",
        scopeType: "org",
      }),
    );
  });

  it("rejects primary personal runtime selected for shared API chat context", async () => {
    mockFindRuntime.mockResolvedValueOnce(personalRuntime);

    await expect(assertPrimaryRuntimeInvocationAllowedForContext({
      companyId: "company-1",
      userId: "user-1",
    })).rejects.toMatchObject({
      decision: expect.objectContaining({ code: "runtime_class_scope_mismatch" }),
    });
  });

  it("preserves personal runtime invocation in the owner's personal workspace", async () => {
    mockFindWorkspace.mockResolvedValueOnce({
      id: "workspace-personal",
      type: "personal",
      ownerUserId: "user-1",
      companyId: null,
    });

    await expect(assertRuntimeInvocationAllowedForContext(personalRuntime, {
      workspaceId: "workspace-personal",
      userId: "user-1",
    })).resolves.toBeUndefined();

    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("rejects personal runtime invocation from a company workspace", async () => {
    mockFindWorkspace.mockResolvedValueOnce({
      id: "workspace-company",
      type: "company",
      ownerUserId: null,
      companyId: "company-1",
    });

    await expect(assertRuntimeInvocationAllowedForContext(personalRuntime, {
      workspaceId: "workspace-company",
      userId: "user-1",
    })).rejects.toMatchObject({
      decision: expect.objectContaining({ code: "runtime_class_scope_mismatch" }),
    });
  });
});
