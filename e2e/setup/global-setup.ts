import { request } from "@playwright/test";

/**
 * Playwright global setup: creates the first-user account. Individual tests
 * opt into authentication with the login helpers so unauthenticated API
 * coverage stays meaningful.
 */
async function globalSetup() {
  const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
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

  // Create a test user. The e2e web server starts with a freshly seeded DB, so
  // this is the first user and receives the super_admin role.
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
    throw new Error(`[global-setup] Signup response ${signupRes.status()}: ${body}`);
  }

  await api.dispose();
}

export default globalSetup;
