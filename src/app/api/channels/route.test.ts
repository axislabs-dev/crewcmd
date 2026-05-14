import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSelectFrom = vi.fn();
const mockInsertValues = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelectFrom }),
    insert: () => ({ values: mockInsertValues }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  channels: {
    id: "channels.id",
    companyId: "channels.companyId",
    workspaceId: "channels.workspaceId",
    archivedAt: "channels.archivedAt",
    updatedAt: "channels.updatedAt",
  },
  channelMembers: {
    id: "channelMembers.id",
    channelId: "channelMembers.channelId",
    memberType: "channelMembers.memberType",
    userId: "channelMembers.userId",
    agentId: "channelMembers.agentId",
    role: "channelMembers.role",
  },
  users: {
    id: "users.id",
    name: "users.name",
    email: "users.email",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  desc: (arg: unknown) => ({ op: "desc", arg }),
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  inArray: (left: unknown, values: unknown[]) => ({ op: "inArray", left, values }),
  isNull: (arg: unknown) => ({ op: "isNull", arg }),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

const mockResolveAccessibleWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

const mockResolveCurrentUser = vi.fn();
vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: (...args: unknown[]) => mockResolveCurrentUser(...args),
}));

const mockCanAccessChatSession = vi.fn();
vi.mock("@/lib/chat-session-access", () => ({
  canAccessChatSession: (...args: unknown[]) => mockCanAccessChatSession(...args),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("/api/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockResolveCurrentUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    mockCanAccessChatSession.mockResolvedValue(true);
  });

  it("lists only readable channels with members and management metadata", async () => {
    const channelOne = { id: "channel_1", name: "security", companyId: "co-1", workspaceId: null, visibility: "restricted", updatedAt: new Date(), archivedAt: null };
    const channelTwo = { id: "channel_other", name: "private", companyId: "co-1", workspaceId: null, visibility: "private", updatedAt: new Date(), archivedAt: null };
    mockSelectFrom
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([channelOne, channelTwo]) }) }),
      })
      .mockReturnValueOnce({
        leftJoin: () => ({
          where: () => Promise.resolve([
            { id: "m1", channelId: "channel_1", memberType: "user", userId: "user-1", agentId: null, role: "owner", name: "Owner", email: "owner@example.com" },
          ]),
        }),
      });
    mockCanAccessChatSession.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await GET(makeRequest("/api/channels?companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.channels).toHaveLength(1);
    expect(body.channels[0].id).toBe("channel_1");
    expect(body.channels[0].canManage).toBe(true);
    expect(body.channels[0].members).toHaveLength(1);
  });

  it("creates a restricted channel and owner membership", async () => {
    const created = { id: "channel_new", name: "incidents", companyId: "co-1", workspaceId: null, visibility: "restricted", description: "prod incidents" };
    mockInsertValues
      .mockReturnValueOnce({ returning: () => Promise.resolve([created]) })
      .mockReturnValueOnce({ returning: () => Promise.resolve([{ id: "member-1" }]) });

    const res = await POST(makeRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({ companyId: "co-1", name: "incidents", purpose: "prod incidents" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.channel.id).toBe("channel_new");
    expect(body.channel.canManage).toBe(true);
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("requires an accessible workspace", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const res = await GET(makeRequest("/api/channels?companyId=co-2"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSelectFrom).not.toHaveBeenCalled();
  });
});
