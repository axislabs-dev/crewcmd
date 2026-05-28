import { test, expect } from "@playwright/test";
import { uniqueName, loginViaApi } from "./helpers";

test.describe("API authentication", () => {
  test.describe("business data requires authentication", () => {
    const protectedGets = [
      "/api/agents",
      "/api/agents/NOPE/status",
      "/api/agents/NOPE/output",
      "/api/agents/NOPE/output/stream",
      "/api/tasks",
      "/api/tasks/00000000-0000-4000-8000-000000000000",
      "/api/tasks/00000000-0000-4000-8000-000000000000/comments",
      "/api/tasks/00000000-0000-4000-8000-000000000000/images",
      "/api/tasks/00000000-0000-4000-8000-000000000000/time-entries",
      "/api/projects",
      "/api/projects/00000000-0000-4000-8000-000000000000",
      "/api/inbox",
      "/api/inbox/stats",
      "/api/docs/00000000-0000-4000-8000-000000000000",
      "/api/time-entries",
      "/api/blueprints",
      "/api/blueprints/builtin-startup-founding-team",
      "/api/skills",
      "/api/skills/browse",
      "/api/skills/sync-status",
      "/api/runtimes",
      "/api/schedules",
      "/api/automations/runs?job_id=e2e",
      "/api/openclaw/agents",
      "/api/openclaw/bridge/status",
      "/api/openclaw/health",
      "/api/openclaw/nodes",
      "/api/runtime/check",
      "/api/runtime/status",
      "/api/cron/triage",
      "/api/cron/axiom-research",
    ];

    for (const path of protectedGets) {
      test(`GET ${path} without auth returns 401`, async ({ request }) => {
        const res = await request.get(path);
        expect(res.status()).toBe(401);
      });
    }
  });

  test.describe("public auth bootstrap endpoints", () => {
    test("GET /api/health is public", async ({ request }) => {
      const res = await request.get("/api/health");
      expect(res.status()).toBe(200);
    });

    test("GET /api/auth/status is public", async ({ request }) => {
      const res = await request.get("/api/auth/status");
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("hasUsers");
    });
  });

  test.describe("mutations require authentication", () => {
    test("POST /api/tasks without auth returns 401", async ({ request }) => {
      const res = await request.post("/api/tasks", {
        data: {
          title: uniqueName("Unauthed-Task"),
          status: "inbox",
        },
      });
      expect(res.status()).toBe(401);
    });

    test("POST /api/projects without auth returns 401", async ({ request }) => {
      const res = await request.post("/api/projects", {
        data: { name: uniqueName("Unauthed-Project") },
      });
      expect(res.status()).toBe(401);
    });

    test("PATCH /api/tasks/:id without auth returns 401", async ({ request }) => {
      const res = await request.patch("/api/tasks/00000000-0000-4000-8000-000000000000", {
        data: { status: "done" },
      });
      expect(res.status()).toBe(401);
    });

    test("DELETE /api/projects/:id without auth returns 401", async ({ request }) => {
      const res = await request.delete("/api/projects/00000000-0000-4000-8000-000000000000");
      expect(res.status()).toBe(401);
    });

    test("POST /api/runtimes/probe without auth returns 401", async ({ request }) => {
      const res = await request.post("/api/runtimes/probe", {
        data: { mode: "paste", config: "{}" },
      });
      expect(res.status()).toBe(401);
    });

    test("PATCH /api/schedules/:id without auth returns 401", async ({ request }) => {
      const res = await request.patch("/api/schedules/e2e-schedule", {
        data: { enabled: false },
      });
      expect(res.status()).toBe(401);
    });

    test("PATCH /api/agents/:callsign/skills/:id without auth returns 401", async ({ request }) => {
      const res = await request.patch("/api/agents/NOPE/skills/00000000-0000-4000-8000-000000000000", {
        data: { enabled: false },
      });
      expect(res.status()).toBe(401);
    });

    test("DELETE /api/agents/:callsign/skills/:id without auth returns 401", async ({ request }) => {
      const res = await request.delete("/api/agents/NOPE/skills/00000000-0000-4000-8000-000000000000");
      expect(res.status()).toBe(401);
    });

    test("POST /api/agents/access without auth returns 401", async ({ request }) => {
      const res = await request.post("/api/agents/access", {
        data: { agentId: "agent", userId: "user" },
      });
      expect(res.status()).toBe(401);
    });

    test("DELETE /api/agents/access/:id without auth returns 401", async ({ request }) => {
      const res = await request.delete("/api/agents/access/00000000-0000-4000-8000-000000000000");
      expect(res.status()).toBe(401);
    });

    test("POST /api/runtime/check without auth returns 401", async ({ request }) => {
      const res = await request.post("/api/runtime/check");
      expect(res.status()).toBe(401);
    });
  });

  test.describe("Bearer token auth works for mutations", () => {
    test("POST /api/tasks with valid Bearer succeeds", async ({ request }) => {
      const secret = process.env.HEARTBEAT_SECRET;
      // Only run if HEARTBEAT_SECRET is set — in PGlite dev the env var
      // may be unset and bearer check is skipped entirely
      test.skip(!secret, "HEARTBEAT_SECRET not set — bearer auth disabled");

      const res = await request.post("/api/tasks", {
        data: {
          title: uniqueName("Bearer-Task"),
          status: "inbox",
        },
        headers: {
          Authorization: `Bearer ${secret}`,
        },
      });
      expect(res.status()).toBe(201);
    });

    test("POST /api/tasks with invalid Bearer returns 401", async ({ request }) => {
      const res = await request.post("/api/tasks", {
        data: {
          title: uniqueName("BadBearer-Task"),
          status: "inbox",
        },
        headers: {
          Authorization: "Bearer totally-wrong-token",
        },
      });
      // Without HEARTBEAT_SECRET set, the bearer check is skipped and falls
      // through to session check (also no session → 401)
      expect(res.status()).toBe(401);
    });
  });

  test.describe("session auth works for mutations", () => {
    test("POST /api/tasks with session cookie succeeds", async ({ request }) => {
      await loginViaApi(request);

      const res = await request.post("/api/tasks", {
        data: {
          title: uniqueName("Session-Task"),
          status: "inbox",
        },
      });
      expect(res.status()).toBe(201);
    });

    test("POST /api/projects with session cookie succeeds", async ({ request }) => {
      await loginViaApi(request);

      const res = await request.post("/api/projects", {
        data: { name: uniqueName("Session-Project") },
      });
      expect(res.status()).toBe(201);
    });
  });

  test.describe("signup flow", () => {
    test("GET /api/auth/status returns hasUsers", async ({ request }) => {
      const res = await request.get("/api/auth/status");
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.hasUsers).toBe(true); // global-setup created a user
    });

    test("signup with weak password returns 400", async ({ request }) => {
      const res = await request.post("/api/auth/signup", {
        data: {
          name: "Weak",
          email: "weak@test.com",
          password: "short",
        },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("8 characters");
    });

    test("signup without invite token is rejected (not first user)", async ({ request }) => {
      const res = await request.post("/api/auth/signup", {
        data: {
          name: "No Invite",
          email: `noinvite-${Date.now()}@test.com`,
          password: "longpassword123",
        },
      });
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("invite");
    });

    test("signup with duplicate email returns 409", async ({ request }) => {
      const res = await request.post("/api/auth/signup", {
        data: {
          name: "Duplicate",
          email: "e2e@crewcmd.test",
          password: "testpassword123",
        },
      });
      // Either 409 (duplicate) or 403 (invite required) depending on order
      expect([403, 409]).toContain(res.status());
    });
  });
});
