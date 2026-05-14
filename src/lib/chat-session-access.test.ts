import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSelect = vi.fn();
const mockResolveAccessibleWorkspace = vi.fn();
const mockResolveCurrentUser = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  channelMembers: {
    id: "channelMembers.id",
    channelId: "channelMembers.channelId",
    memberType: "channelMembers.memberType",
    userId: "channelMembers.userId",
  },
  chatSessions: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: (...args: unknown[]) => mockResolveCurrentUser(...args),
}));

import { canAccessChatSession } from "./chat-session-access";

function request() {
  return new NextRequest(new URL("/api/chat/messages", "http://localhost:3000"));
}

function membershipLookup(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe("canAccessChatSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockResolveCurrentUser.mockResolvedValue({ id: "user-1" });
    mockSelect.mockReturnValue(membershipLookup([{ id: "member-1" }]));
  });

  it("allows non-channel sessions after explicit workspace access", async () => {
    await expect(canAccessChatSession(request(), {
      workspaceId: "ws-1",
      companyId: "co-1",
      channelId: null,
    })).resolves.toBe(true);

    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitWorkspaceId: "ws-1",
      requireExplicitForBearer: true,
    }));
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("requires explicit channel membership for channel sessions", async () => {
    await expect(canAccessChatSession(request(), {
      workspaceId: "ws-1",
      companyId: "co-1",
      channelId: "channel_1",
    })).resolves.toBe(true);

    expect(mockResolveCurrentUser).toHaveBeenCalled();
    expect(mockSelect).toHaveBeenCalled();
  });

  it("denies channel sessions when the current user is not a channel member", async () => {
    mockSelect.mockReturnValueOnce(membershipLookup([]));

    await expect(canAccessChatSession(request(), {
      workspaceId: "ws-1",
      companyId: "co-1",
      channelId: "channel_1",
    })).resolves.toBe(false);
  });

  it("denies channel sessions when workspace scope is inaccessible", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);

    await expect(canAccessChatSession(request(), {
      workspaceId: "other-ws",
      companyId: "co-1",
      channelId: "channel_1",
    })).resolves.toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
