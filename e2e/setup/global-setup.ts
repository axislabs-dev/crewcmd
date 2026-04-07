import { request } from "@playwright/test";

/**
 * Playwright global setup: ensures a test user exists and the app is seeded.
 *
 * The dev server (PGlite) auto-seeds via `pnpm dev`, so we just need to
 * create a test user account for authenticated tests.
 */
async function globalSetup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  const api = await request.newContext({ baseURL });

  // Wait for the app to be ready (healthcheck via auth status)
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await api.get("/api/auth/status");
      if (res.ok()) {
        ready = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("App not ready after 20s");

  // Create a test user (first user gets super_admin role)
  const signupRes = await api.post("/api/auth/signup", {
    data: {
      name: "E2E Test User",
      email: "e2e@crewcmd.test",
      password: "testpassword123",
    },
  });

  // 200 = created, 409 = already exists — both fine
  if (!signupRes.ok() && signupRes.status() !== 409) {
    const body = await signupRes.text();
    console.warn(`[global-setup] Signup response ${signupRes.status()}: ${body}`);
  }

  await api.dispose();
}

export default globalSetup;
