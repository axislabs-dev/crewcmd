import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockDocs = [
  {
    id: "doc-1",
    title: "Runtime setup",
    content: "Configure the runtime",
    category: "general",
    docType: "runbook",
    visibility: "company",
    authorAgentId: "agent-1",
    authorUserId: null,
    projectId: null,
    taskId: null,
    tags: ["runtime"],
    pinned: false,
    workspaceId: "ws-1",
    companyId: "co-1",
    updatedAt: "2026-04-01T00:00:00Z",
  },
];

const mockWhere = vi.fn();
const mockReturning = vi.fn();
const mockRequireUserOrRuntimeAuth = vi.fn();
const mockResolveAccessibleWorkspace = vi.fn();
const mockGetCompanyIdForWorkspace = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockReturning,
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  docs: {
    workspaceId: "workspaceId",
  },
}));

vi.mock("@/lib/require-auth", () => ({
  requireUserOrRuntimeAuth: (...args: unknown[]) => mockRequireUserOrRuntimeAuth(...args),
}));

vi.mock("@/lib/workspace", () => ({
  getCompanyIdForWorkspace: (...args: unknown[]) => mockGetCompanyIdForWorkspace(...args),
  isHeartbeatBearerRequest: vi.fn(async () => false),
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("/api/docs auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUserOrRuntimeAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockGetCompanyIdForWorkspace.mockResolvedValue("co-1");
    mockWhere.mockResolvedValue(mockDocs);
  });

  it("rejects unauthenticated document reads before workspace resolution", async () => {
    mockRequireUserOrRuntimeAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await GET(makeRequest("/api/docs?workspaceId=ws-1"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("lists scoped documents when user or runtime auth succeeds", async () => {
    const res = await GET(makeRequest("/api/docs?workspaceId=ws-1&docType=runbook"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("doc-1");
    expect(mockRequireUserOrRuntimeAuth).toHaveBeenCalledTimes(1);
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith({
      request: expect.any(NextRequest),
      explicitWorkspaceId: "ws-1",
      explicitCompanyId: null,
      requireExplicitForBearer: true,
    });
  });

  it("rejects unauthenticated document creation before parsing the body", async () => {
    mockRequireUserOrRuntimeAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(
      makeRequest("/api/docs", {
        method: "POST",
        body: "{",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mockReturning).not.toHaveBeenCalled();
  });
});
