import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── DB mocks ────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    insert: () => ({ values: mockInsert }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatSessions: Symbol("chatSessions"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

const mockResolveAccessibleWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

const mockResolveReadableAgentByCallsign = vi.fn();
vi.mock("@/lib/agent-route-auth", () => ({
  resolveReadableAgentByCallsign: (...a: unknown[]) => mockResolveReadableAgentByCallsign(...a),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

// ── GET /api/chat/sessions ──────────────────────────────────────
describe("GET /api/chat/sessions", () => {
  const mockSessions = [
    { id: "s1", agentId: "neo", companyId: "co-1", title: null, updatedAt: "2026-04-01T00:00:00Z" },
    { id: "s2", agentId: "cipher", companyId: "co-1", title: "Debug session", updatedAt: "2026-04-02T00:00:00Z" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
  });

  it("returns sessions for a company", async () => {
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockSessions) }) }),
    });

    const res = await GET(makeRequest("/api/chat/sessions?companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(2);
  });

  it("returns 400 without companyId", async () => {
    const res = await GET(makeRequest("/api/chat/sessions"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("companyId required");
  });

  it("filters by agentId when provided", async () => {
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([mockSessions[0]]) }) }),
    });

    const res = await GET(makeRequest("/api/chat/sessions?companyId=co-1&agentId=neo"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].agentId).toBe("neo");
  });

  it("forbids listing sessions outside an accessible company", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const res = await GET(makeRequest("/api/chat/sessions?companyId=co-2"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

// ── POST /api/chat/sessions ─────────────────────────────────────
describe("POST /api/chat/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockResolveReadableAgentByCallsign.mockResolvedValue({ id: "agent-1", callsign: "Forge" });
  });

  it("creates a session", async () => {
    const created = { id: "s3", agentId: "forge", companyId: "co-1", workspaceId: "ws-1", title: null };
    mockInsert.mockReturnValue({
      returning: () => Promise.resolve([created]),
    });

    const res = await POST(
      makeRequest("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ agentId: "Forge", companyId: "co-1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.session.id).toBe("s3");
  });

  it("returns 400 when agentId missing", async () => {
    const res = await POST(
      makeRequest("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ companyId: "co-1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("agentId and companyId required");
  });

  it("returns 400 when companyId missing", async () => {
    const res = await POST(
      makeRequest("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ agentId: "neo" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("agentId and companyId required");
  });

  it("forbids creating sessions outside an accessible company", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const res = await POST(
      makeRequest("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ agentId: "neo", companyId: "co-2" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("does not create sessions for unreadable agents", async () => {
    mockResolveReadableAgentByCallsign.mockResolvedValue(null);

    const res = await POST(
      makeRequest("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ agentId: "ghost", companyId: "co-1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Agent not found");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
