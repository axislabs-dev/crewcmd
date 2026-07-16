import { test, expect } from "@playwright/test";
import { apiPost, apiGet, apiPatch, uniqueName, loginViaApi } from "./helpers";

test.describe("Agent management", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("GET /api/agents returns created agents", async ({ request }) => {
    const callsign = uniqueName("LISTAG").toUpperCase().replace(/-/g, "");
    await apiPost(
      request,
      "/api/agents",
      {
        name: "Listed Agent",
        callsign,
        title: "E2E Listed Agent",
      },
      { expectStatus: 201 },
    );

    const data = await apiGet(request, "/api/agents");
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);

    const callsigns = data.agents.map((a: { callsign: string }) => a.callsign);
    expect(callsigns).toContain(callsign);
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

  test("agent API responses never expose credential-shaped configuration", async ({ request }) => {
    const callsign = uniqueName("SAFEAGENT").toUpperCase().replace(/-/g, "");
    const createSecret = `create-${uniqueName("secret")}`;
    const updateSecret = `update-${uniqueName("secret")}`;
    const created = await apiPost(
      request,
      "/api/agents",
      {
        name: "Browser Safe Agent",
        callsign,
        adapterType: "http",
        adapterConfig: {
          url: `https://user:${createSecret}@example.com/v1?token=${createSecret}&mode=fast`,
          headers: { Authorization: `Bearer ${createSecret}` },
          envVars: { PROVIDER_API_KEY: createSecret },
          apiKey: createSecret,
          timeoutSec: 45,
        },
      },
      { expectStatus: 201 },
    );

    const listed = await apiGet(request, "/api/agents");
    const listAgent = listed.agents.find((agent: { callsign: string }) => agent.callsign === callsign);
    const detailed = await apiGet(request, `/api/agents/${callsign}`);
    const updated = await apiPatch(request, `/api/agents/${callsign}`, {
      adapterConfig: {
        ...created.adapterConfig,
        headers: { Authorization: `Bearer ${updateSecret}` },
        apiKey: updateSecret,
      },
    });

    for (const responseAgent of [created, listAgent, detailed, updated]) {
      const serialized = JSON.stringify(responseAgent);
      expect(serialized).not.toContain(createSecret);
      expect(serialized).not.toContain(updateSecret);
      expect(responseAgent.adapterConfig).toMatchObject({
        url: "https://example.com/v1?mode=fast",
        timeoutSec: 45,
      });
      expect(responseAgent.adapterConfig).not.toHaveProperty("headers");
      expect(responseAgent.adapterConfig).not.toHaveProperty("envVars");
      expect(responseAgent.adapterConfig).not.toHaveProperty("apiKey");
    }
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
    const callsign = uniqueName("GETAG").toUpperCase().replace(/-/g, "");
    await apiPost(
      request,
      "/api/agents",
      { name: "Get Agent", callsign, title: "Lookup Engineer" },
      { expectStatus: 201 },
    );

    const data = await apiGet(request, `/api/agents/${callsign}`);
    expect(data.callsign).toBe(callsign);
    expect(data.name).toBe("Get Agent");
    expect(data.title).toBe("Lookup Engineer");
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
    const callsign = uniqueName("STATAG").toUpperCase().replace(/-/g, "");
    await apiPost(
      request,
      "/api/agents",
      { name: "Status Agent", callsign, title: "Status Engineer" },
      { expectStatus: 201 },
    );

    const data = await apiGet(request, `/api/agents/${callsign}/status`);
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
