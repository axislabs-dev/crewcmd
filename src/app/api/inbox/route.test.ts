import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  requireUserOrRuntimeAuth: vi.fn(),
  resolveAccessibleWorkspace: vi.fn(),
  getCompanyIdForWorkspace: vi.fn(),
  extractSqlRows: vi.fn(),
  normalizeInboxMessage: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    execute: (...args: unknown[]) => mocks.execute(...args),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  sql: {
    raw: (value: string) => value,
  },
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "inbox-message-1",
}));

vi.mock("@/lib/require-auth", () => ({
  requireUserOrRuntimeAuth: (...args: unknown[]) => mocks.requireUserOrRuntimeAuth(...args),
}));

vi.mock("@/lib/workspace", () => ({
  getCompanyIdForWorkspace: (...args: unknown[]) => mocks.getCompanyIdForWorkspace(...args),
  isHeartbeatBearerRequest: vi.fn(async () => false),
  resolveAccessibleWorkspace: (...args: unknown[]) => mocks.resolveAccessibleWorkspace(...args),
}));

vi.mock("@/lib/sql-result", () => ({
  extractSqlRows: (...args: unknown[]) => mocks.extractSqlRows(...args),
}));

vi.mock("@/lib/inbox-response", () => ({
  normalizeInboxMessage: (...args: unknown[]) => mocks.normalizeInboxMessage(...args),
  normalizeInboxMessages: vi.fn(() => []),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>, authorization = "Bearer heartbeat-secret") {
  return new NextRequest("http://localhost:3000/api/inbox", {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify(body),
  });
}

function inboxBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    fromAgentId: "agent-1",
    type: "update",
    title: "Runtime update",
    body: "Done",
    ...overrides,
  };
}

describe("POST /api/inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserOrRuntimeAuth.mockResolvedValue(null);
    mocks.resolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mocks.getCompanyIdForWorkspace.mockResolvedValue("co-1");
    mocks.execute.mockResolvedValue({});
    mocks.extractSqlRows.mockReturnValue([{ id: "inbox-message-1" }]);
    mocks.normalizeInboxMessage.mockReturnValue({ id: "inbox-message-1", title: "Runtime update" });
  });

  it("rejects callers that fail explicit user-or-runtime auth", async () => {
    mocks.requireUserOrRuntimeAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(makeRequest(inboxBody()));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mocks.resolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("uses explicit user-or-runtime auth before creating an inbox message", async () => {
    const res = await POST(makeRequest(inboxBody()));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ id: "inbox-message-1" });
    expect(mocks.requireUserOrRuntimeAuth).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitWorkspaceId: "ws-1",
    }));
  });
});
