import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createdRows: Array<Record<string, unknown>> = [];
const updatedRows: Array<Record<string, unknown>> = [];
let existingSkill: Record<string, unknown> | null = null;

vi.mock("@/db", () => ({
  withRetry: (fn: () => Promise<unknown> | unknown) => fn(),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (existingSkill ? [existingSkill] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          const created = { id: "skill-1", ...row };
          createdRows.push(created);
          return [created];
        },
      }),
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const updated = { ...existingSkill, ...row };
            updatedRows.push(updated);
            return [updated];
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  skills: {
    id: Symbol("skills.id"),
    workspaceId: Symbol("skills.workspaceId"),
    slug: Symbol("skills.slug"),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
}));

vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: vi.fn(async () => ({
    id: "workspace-1",
    type: "personal",
    name: "Personal Workspace",
    ownerUserId: "user-1",
    companyId: null,
  })),
}));

const nativeMocks = vi.hoisted(() => {
  const detailCalls: unknown[] = [];
  const installCalls: unknown[] = [];
  let rejectVersionOnce = false;
  let rejectAlreadyExistsOnce = false;

  return {
    detailCalls,
    installCalls,
    setRejectVersionOnce: (value: boolean) => {
      rejectVersionOnce = value;
    },
    setRejectAlreadyExistsOnce: (value: boolean) => {
      rejectAlreadyExistsOnce = value;
    },
    canInstallNativeSkill: vi.fn(async () => true),
    resolveWorkspaceRuntime: vi.fn(async () => ({
      id: "runtime-1",
      gatewayUrl: "ws://localhost:18789",
      authToken: null,
    })),
    withGateway: vi.fn(
      async (
        _runtime: unknown,
        fn: (client: Record<string, unknown>) => Promise<unknown>,
      ) =>
        fn({
          skillsDetail: vi.fn(async (params: unknown) => {
            detailCalls.push(params);
            return {
              slug: "calendar",
              name: "Calendar",
              description: "Manage calendar events.",
              version: "1.2.3",
              owner: "axislabs",
              trust: {
                level: "verified",
                verificationTier: "reviewed",
                scanStatus: "passed",
              },
              warnings: ["requires OAuth"],
            };
          }),
          skillsInstall: vi.fn(async (params: Record<string, unknown>) => {
            installCalls.push(params);
            if (rejectAlreadyExistsOnce) {
              rejectAlreadyExistsOnce = false;
              throw new Error(
                "Skill already exists at /Users/roger/.openclaw/workspace/skills/calendar. Re-run with force/update.",
              );
            }
            if (rejectVersionOnce && params.version) {
              rejectVersionOnce = false;
              throw new Error(
                "ClawHub /api/v1/download failed (404): Version not found",
              );
            }
            return {
              ok: true,
              installed: true,
              slug: "calendar",
              version:
                typeof params.version === "string" ? params.version : "1.2.3",
              path: "skills/calendar",
            };
          }),
        }),
    ),
  };
});

vi.mock("@/lib/native-clawhub", () => nativeMocks);

import { POST } from "./route";

describe("POST /api/skills/import native ClawHub", () => {
  beforeEach(() => {
    createdRows.length = 0;
    updatedRows.length = 0;
    existingSkill = null;
    nativeMocks.detailCalls.length = 0;
    nativeMocks.installCalls.length = 0;
    nativeMocks.setRejectVersionOnce(false);
    nativeMocks.setRejectAlreadyExistsOnce(false);
    vi.clearAllMocks();
  });

  it("installs a catalog skill into OpenClaw and reflects it as a CrewCMD skill", async () => {
    const request = new NextRequest("http://localhost/api/skills/import", {
      method: "POST",
      body: JSON.stringify({
        provider: "clawhub",
        slug: "calendar",
        version: "1.2.3",
        workspaceId: "workspace-1",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(nativeMocks.canInstallNativeSkill).toHaveBeenCalledOnce();
    expect(nativeMocks.withGateway).toHaveBeenCalledOnce();
    expect(createdRows).toHaveLength(1);
    expect(json).toMatchObject({
      id: "skill-1",
      workspaceId: "workspace-1",
      name: "Calendar",
      slug: "calendar",
      source: "clawhub",
      sourceRef: "skills/calendar",
      version: "1.2.3",
      installed: true,
    });
    expect(json.metadata.provider).toMatchObject({
      id: "clawhub",
      skillId: "calendar",
      version: "1.2.3",
    });
    expect(json.metadata.native).toMatchObject({
      runtimeId: "runtime-1",
      gatewayUrl: "ws://localhost:18789",
      installPath: "skills/calendar",
      installStatus: "installed",
    });
    expect(json.metadata.update).toMatchObject({
      status: "current",
      currentVersion: "1.2.3",
    });
  });

  it("omits placeholder versions and retries latest when ClawHub rejects a stale version", async () => {
    nativeMocks.setRejectVersionOnce(true);
    const request = new NextRequest("http://localhost/api/skills/import", {
      method: "POST",
      body: JSON.stringify({
        provider: "clawhub",
        slug: "calendar",
        version: "0.0.0",
        workspaceId: "workspace-1",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(nativeMocks.detailCalls[0]).toEqual({ slug: "calendar" });
    expect(nativeMocks.installCalls).toEqual([
      { source: "clawhub", slug: "calendar", version: "1.2.3" },
      { source: "clawhub", slug: "calendar" },
    ]);
    expect(json.version).toBe("1.2.3");
  });

  it("reconciles a gateway skill that is already installed in the workspace", async () => {
    nativeMocks.setRejectAlreadyExistsOnce(true);
    const request = new NextRequest("http://localhost/api/skills/import", {
      method: "POST",
      body: JSON.stringify({
        provider: "clawhub",
        slug: "calendar",
        version: "1.2.3",
        workspaceId: "workspace-1",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createdRows).toHaveLength(1);
    expect(json).toMatchObject({
      slug: "calendar",
      source: "clawhub",
      sourceRef: "/Users/roger/.openclaw/workspace/skills/calendar",
      installed: true,
    });
    expect(json.metadata.native).toMatchObject({
      installPath: "/Users/roger/.openclaw/workspace/skills/calendar",
      installStatus: "installed",
    });
  });
});
