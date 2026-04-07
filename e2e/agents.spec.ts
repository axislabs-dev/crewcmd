import { test, expect } from "@playwright/test";
import { apiPost, apiGet, apiPatch, uniqueName, loginViaApi } from "./helpers";

test.describe("Agent management", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("GET /api/agents returns seeded agents", async ({ request }) => {
    const data = await apiGet(request, "/api/agents");
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    // Seed creates 7 agents
    expect(data.agents.length).toBeGreaterThanOrEqual(7);

    const callsigns = data.agents.map((a: { callsign: string }) => a.callsign);
    expect(callsigns).toContain("Neo");
    expect(callsigns).toContain("Cipher");
    expect(callsigns).toContain("Havoc");
  });

  test("POST /api/agents creates a new agent", async ({ request }) => {
    const callsign = uniqueName("E2EAGENT").toUpperCase().replace(/-/g, "");
    const agent = await apiPost(
      request,
      "/api/agents",
      {
        name: "Test Agent",
        callsign,
        title: "E2E Test Engineer",
        emoji: "🧪",
        color: "#0099ff",
        role: "engineer",
      },
      { expectStatus: 201 },
    );

    expect(agent.callsign).toBe(callsign);
    expect(agent.name).toBe("Test Agent");
    expect(agent.title).toBe("E2E Test Engineer");
    expect(agent.emoji).toBe("🧪");
    expect(agent.role).toBe("engineer");
  });

  test("POST /api/agents returns 409 for duplicate callsign", async ({ request }) => {
    const callsign = uniqueName("DUP").toUpperCase().replace(/-/g, "");

    await apiPost(
      request,
      "/api/agents",
      { name: "First", callsign },
      { expectStatus: 201 },
    );

    const res = await request.post("/api/agents", {
      data: { name: "Second", callsign },
    });
    expect(res.status()).toBe(409);
  });

  test("GET /api/agents/:callsign returns a single agent", async ({ request }) => {
    const data = await apiGet(request, "/api/agents/Neo");
    expect(data.callsign).toBe("Neo");
    expect(data.name).toBe("Neo");
    expect(data.title).toBe("Chief Revenue Officer");
  });

  test("PATCH /api/agents/:callsign updates an agent", async ({ request }) => {
    const callsign = uniqueName("UPDAG").toUpperCase().replace(/-/g, "");
    await apiPost(
      request,
      "/api/agents",
      { name: "Before", callsign, title: "Junior" },
      { expectStatus: 201 },
    );

    const updated = await apiPatch(request, `/api/agents/${callsign}`, {
      title: "Senior Engineer",
      color: "#ff00ff",
    });

    expect(updated.title).toBe("Senior Engineer");
    expect(updated.color).toBe("#ff00ff");
  });

  test("DELETE /api/agents/:callsign removes an agent", async ({ request }) => {
    const callsign = uniqueName("DELAG").toUpperCase().replace(/-/g, "");
    await apiPost(
      request,
      "/api/agents",
      { name: "ToDelete", callsign },
      { expectStatus: 201 },
    );

    const res = await request.delete(`/api/agents/${callsign}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify gone
    const getRes = await request.get(`/api/agents/${callsign}`);
    expect(getRes.status()).toBe(404);
  });

  test("GET /api/agents/:callsign/status returns status info", async ({ request }) => {
    const data = await apiGet(request, "/api/agents/Neo/status");
    // Status endpoint returns running state info
    expect(data).toHaveProperty("status");
  });

  test("agent with reportsTo creates hierarchy", async ({ request }) => {
    const bossCallsign = uniqueName("BOSS").toUpperCase().replace(/-/g, "");
    const subCallsign = uniqueName("SUB").toUpperCase().replace(/-/g, "");

    await apiPost(
      request,
      "/api/agents",
      { name: "Boss Agent", callsign: bossCallsign, title: "Manager" },
      { expectStatus: 201 },
    );

    const sub = await apiPost(
      request,
      "/api/agents",
      {
        name: "Sub Agent",
        callsign: subCallsign,
        title: "Worker",
        reportsTo: bossCallsign,
      },
      { expectStatus: 201 },
    );

    expect(sub.reportsTo).toBe(bossCallsign);
  });
});
