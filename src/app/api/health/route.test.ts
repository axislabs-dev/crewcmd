import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures mockExecute is available when the hoisted vi.mock runs
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { execute: mockExecute },
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with status ok when database is connected", async () => {
    mockExecute.mockResolvedValueOnce([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");
    expect(body.version).toEqual(expect.any(String));
    expect(body.uptime).toEqual(expect.any(Number));
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.error).toBeUndefined();
  });

  it("returns 503 with degraded status when database fails", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("error");
    expect(body.error).toBe("Connection refused");
  });
});
