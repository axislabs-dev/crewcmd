import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockTasks = [
  { id: "t1", title: "Fix bug", status: "inbox", priority: "high", assignedAgentId: "a1", humanAssignee: null, updatedAt: "2026-04-01T00:00:00Z" },
  { id: "t2", title: "Write docs", status: "done", priority: "low", assignedAgentId: null, humanAssignee: "roger", updatedAt: "2026-04-02T00:00:00Z" },
];

const mockFrom = vi.fn();
const mockReturning = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({
      values: () => ({
        returning: mockReturning,
        catch: () => Promise.resolve(),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  tasks: Symbol("tasks"),
  activityLog: Symbol("activityLog"),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

// Mock drizzle-orm operators (used for errorHash dedup)
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  ne: vi.fn(),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("GET /api/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockResolvedValue(mockTasks);
  });

  it("returns all tasks", async () => {
    const res = await GET(makeRequest("/api/tasks"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
  });

  it("filters by status", async () => {
    const res = await GET(makeRequest("/api/tasks?status=done"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("Write docs");
  });

  it("filters by agentId", async () => {
    const res = await GET(makeRequest("/api/tasks?agentId=a1"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("Fix bug");
  });

  it("filters unassigned tasks", async () => {
    const res = await GET(makeRequest("/api/tasks?unassigned=true"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].assignedAgentId).toBeNull();
  });

  it("excludes tasks with human assignee", async () => {
    const res = await GET(makeRequest("/api/tasks?excludeHumanAssignee=true"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].humanAssignee).toBeNull();
  });
});

describe("POST /api/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
  });

  it("creates a task and returns 201", async () => {
    const created = { id: "t3", title: "New task", status: "inbox", priority: "medium" };
    mockReturning.mockResolvedValue([created]);

    const res = await POST(
      makeRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "New task" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe("New task");
  });

  it("returns 400 when title is missing", async () => {
    const res = await POST(
      makeRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("title is required");
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(
      makeRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "Nope" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });
});
