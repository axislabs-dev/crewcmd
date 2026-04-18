import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock data
const mockProjects = [
  { id: "p1", name: "Alpha", description: null, url: null, folder: null, color: "#00f0ff", status: "active", ownerAgentId: null, documents: null },
  { id: "p2", name: "Beta", description: "desc", url: "https://example.com", folder: "/tmp/beta", color: "#ff0000", status: "archived", ownerAgentId: "a1", documents: null },
];

const mockFrom = vi.fn();
const mockReturning = vi.fn();
const mockResolveAccessibleWorkspace = vi.fn();
const mockGetCompanyIdForWorkspace = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockFrom,
      }),
    }),
    insert: () => ({ values: () => ({ returning: mockReturning }) }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  projects: Symbol("projects"),
}));

// Mock requireAuth — default: authorized
const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock("@/lib/workspace", () => ({
  isHeartbeatBearerRequest: vi.fn(async () => false),
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
  getCompanyIdForWorkspace: (...args: unknown[]) => mockGetCompanyIdForWorkspace(...args),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("GET /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockGetCompanyIdForWorkspace.mockResolvedValue("co-1");
    mockFrom.mockResolvedValue(mockProjects);
  });

  it("returns all projects", async () => {
    const res = await GET(makeRequest("/api/projects"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("Alpha");
  });

  it("filters by status query param", async () => {
    const res = await GET(makeRequest("/api/projects?status=archived"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Beta");
  });

  it("filters by ownerId query param", async () => {
    const res = await GET(makeRequest("/api/projects?ownerId=a1"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Beta");
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockGetCompanyIdForWorkspace.mockResolvedValue("co-1");
  });

  it("creates a project and returns 201", async () => {
    const created = { id: "p3", name: "Gamma", description: null, url: "https://example.com/gamma", folder: "/workspace/gamma", color: "#00f0ff", status: "active", ownerAgentId: null, documents: null };
    mockReturning.mockResolvedValue([created]);

    const res = await POST(
      makeRequest("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Gamma", workspaceId: "ws-1", url: "https://example.com/gamma", folder: "/workspace/gamma" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe("Gamma");
    expect(body.url).toBe("https://example.com/gamma");
    expect(body.folder).toBe("/workspace/gamma");
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(
      makeRequest("/api/projects", {
        method: "POST",
        body: JSON.stringify({ workspaceId: "ws-1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("name is required");
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(
      makeRequest("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Nope", workspaceId: "ws-1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });
});
