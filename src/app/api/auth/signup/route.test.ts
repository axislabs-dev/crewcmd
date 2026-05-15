import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: null,
}));

vi.mock("@/db/schema", () => ({
  users: {},
  inviteTokens: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
  },
}));

import { POST, resetSignupRateLimitForTests } from "./route";

function signupRequest(ip: string) {
  return new Request("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

describe("POST /api/auth/signup rate limiting", () => {
  beforeEach(() => {
    resetSignupRateLimitForTests();
    process.env.DATABASE_URL = "postgresql://test";
  });

  it("rate limits repeated signup attempts from the same client", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(signupRequest("203.0.113.10"));
      expect(res.status).toBe(400);
    }

    const limited = await POST(signupRequest("203.0.113.10"));
    const body = await limited.json();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(body.error).toBe("Too many signup attempts. Try again later.");
  });

  it("keeps signup attempt counters separate by client address", async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(signupRequest("203.0.113.10"));
    }

    const res = await POST(signupRequest("203.0.113.11"));

    expect(res.status).toBe(400);
  });
});
