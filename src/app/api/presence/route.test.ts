import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockInsert,
  mockOnConflictDoUpdate,
  mockResolveCurrentUser,
  mockReturning,
  mockValues,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockResolveCurrentUser = vi.fn();

  return {
    mockInsert,
    mockOnConflictDoUpdate,
    mockResolveCurrentUser,
    mockReturning,
    mockValues,
  };
});

vi.mock("@/db", () => ({
  db: { insert: mockInsert },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  userPresence: { userId: Symbol("userPresence.userId") },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: (...args: unknown[]) => mockResolveCurrentUser(...args),
}));

import { POST } from "./route";

describe("POST /api/presence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCurrentUser.mockResolvedValue({ id: "user-1" });
    mockReturning.mockResolvedValue([
      {
        userId: "user-1",
        status: "active",
        customText: null,
        emoji: null,
        manualExpiresAt: null,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  it("does not update the primary key during a presence upsert", async () => {
    const request = new NextRequest("http://localhost:3000/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: expect.not.objectContaining({ userId: expect.anything() }),
    });
  });
});
