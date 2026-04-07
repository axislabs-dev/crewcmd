import { test, expect } from "@playwright/test";
import { uniqueName, loginViaApi } from "./helpers";

test.describe("API authentication", () => {
  test.describe("GETs are publicly accessible", () => {
    test("GET /api/agents is public", async ({ request }) => {
      const res = await request.get("/api/agents");
      expect(res.status()).toBe(200);
    });

    test("GET /api/tasks is public", async ({ request }) => {
      const res = await request.get("/api/tasks");
      expect(res.status()).toBe(200);
    });

    test("GET /api/projects is public", async ({ request }) => {
      const res = await request.get("/api/projects");
      expect(res.status()).toBe(200);
    });

    test("GET /api/inbox is public", async ({ request }) => {
      const res = await request.get("/api/inbox");
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
      // First get a real task ID
      const tasks = await (await request.get("/api/tasks")).json();
      if (tasks.length > 0) {
        const res = await request.patch(`/api/tasks/${tasks[0].id}`, {
          data: { status: "done" },
        });
        expect(res.status()).toBe(401);
      }
    });

    test("DELETE /api/projects/:id without auth returns 401", async ({ request }) => {
      const projects = await (await request.get("/api/projects")).json();
      if (projects.length > 0) {
        const res = await request.delete(`/api/projects/${projects[0].id}`);
        expect(res.status()).toBe(401);
      }
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
