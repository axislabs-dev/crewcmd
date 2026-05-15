import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireAuth = vi.fn();

vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

import { GET, PUT } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/config/nodes", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("/api/config/nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
  });

  it("keeps the read endpoint available", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("Mac Mini M4 (Trading Floor)");
  });

  it("requires authentication before mutating the node map", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await PUT(makeRequest({ "new-node": [] }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("updates the node map for authenticated callers", async () => {
    const res = await PUT(makeRequest({ "Security Bench": [] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("Security Bench");
  });
});
