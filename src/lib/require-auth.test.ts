import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockHasHeartbeatSecret,
  mockMatchesHeartbeatBearerToken,
  mockSelect,
  mockLimit,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasHeartbeatSecret: vi.fn(),
  mockMatchesHeartbeatBearerToken: vi.fn(),
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/lib/heartbeat-secret", () => ({
  hasHeartbeatSecret: () => mockHasHeartbeatSecret(),
  matchesHeartbeatBearerToken: (...args: unknown[]) => mockMatchesHeartbeatBearerToken(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-clause"),
}));

vi.mock("@/db/schema", () => ({
  users: "users-table",
}));

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import { requireAuth, requireRuntimeBearerAuth, requireUserOrRuntimeAuth } from "./require-auth";
import { resolveCurrentUser } from "./resolve-user";

function request(authHeader?: string) {
  return new NextRequest("http://localhost/api/test", {
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
}

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(null);
    mockHasHeartbeatSecret.mockResolvedValue(true);
    mockMatchesHeartbeatBearerToken.mockResolvedValue(true);
  });

  it("rejects HEARTBEAT_SECRET bearer auth for generic session endpoints", async () => {
    const result = await requireAuth(request("Bearer heartbeat-secret"));

    expect(result?.status).toBe(401);
    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockMatchesHeartbeatBearerToken).not.toHaveBeenCalled();
  });

  it("accepts a real user session for generic session endpoints", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });

    await expect(requireAuth(request("Bearer heartbeat-secret"))).resolves.toBeNull();
    expect(mockMatchesHeartbeatBearerToken).not.toHaveBeenCalled();
  });
});

describe("explicit runtime bearer auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(null);
    mockHasHeartbeatSecret.mockResolvedValue(true);
    mockMatchesHeartbeatBearerToken.mockResolvedValue(true);
  });

  it("accepts HEARTBEAT_SECRET bearer auth through the runtime-only helper", async () => {
    await expect(requireRuntimeBearerAuth(request("Bearer heartbeat-secret"))).resolves.toBeNull();

    expect(mockMatchesHeartbeatBearerToken).toHaveBeenCalledWith("Bearer heartbeat-secret");
  });

  it("accepts either session or runtime bearer auth through the explicit combined helper", async () => {
    await expect(requireUserOrRuntimeAuth(request("Bearer heartbeat-secret"))).resolves.toBeNull();

    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockMatchesHeartbeatBearerToken.mockClear();

    await expect(requireUserOrRuntimeAuth(request())).resolves.toBeNull();
    expect(mockMatchesHeartbeatBearerToken).not.toHaveBeenCalled();
  });
});

describe("resolveCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(null);
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockLimit,
        })),
      })),
    });
    mockLimit.mockResolvedValue([]);
  });

  it("does not resolve HEARTBEAT_SECRET bearer auth into a system admin user", async () => {
    await expect(resolveCurrentUser(request("Bearer heartbeat-secret"))).resolves.toBeNull();

    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("still resolves a real session user by id", async () => {
    const user = { id: "user-1", email: "user@example.com", role: "user" };
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockLimit.mockResolvedValue([user]);

    await expect(resolveCurrentUser()).resolves.toBe(user);
  });
});
