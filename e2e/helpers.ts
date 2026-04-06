import { type APIRequestContext, type Page, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE_URL = "http://localhost:3000";

export const TEST_USER = {
  name: "E2E Test User",
  email: "e2e@crewcmd.test",
  password: "testpassword123",
};

/**
 * Bearer token for agent/system auth. Falls back to a test-only value when
 * HEARTBEAT_SECRET is not set (PGlite dev mode still accepts it if the env
 * var is unset, because `requireAuth` skips the bearer check when
 * `expectedToken` is falsy — so session auth is the fallback).
 */
export const BEARER_TOKEN = process.env.HEARTBEAT_SECRET ?? "e2e-test-secret";

// ---------------------------------------------------------------------------
// API helpers (for request-context based tests)
// ---------------------------------------------------------------------------

/** POST JSON and return parsed body. Asserts 2xx unless `expectStatus` given. */
export async function apiPost(
  api: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  opts?: { expectStatus?: number; bearer?: string },
) {
  const headers: Record<string, string> = {};
  if (opts?.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;

  const res = await api.post(path, { data, headers });
  const status = opts?.expectStatus ?? 201;
  expect(res.status(), `POST ${path} → ${res.status()}`).toBe(status);
  return res.json();
}

/** PATCH JSON and return parsed body. */
export async function apiPatch(
  api: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  opts?: { bearer?: string },
) {
  const headers: Record<string, string> = {};
  if (opts?.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;

  const res = await api.patch(path, { data, headers });
  expect(res.status(), `PATCH ${path} → ${res.status()}`).toBe(200);
  return res.json();
}

/** GET JSON. */
export async function apiGet(
  api: APIRequestContext,
  path: string,
  opts?: { expectStatus?: number },
) {
  const res = await api.get(path);
  const status = opts?.expectStatus ?? 200;
  expect(res.status(), `GET ${path} → ${res.status()}`).toBe(status);
  return res.json();
}

/** DELETE and return parsed body. */
export async function apiDelete(
  api: APIRequestContext,
  path: string,
  opts?: { bearer?: string; expectStatus?: number },
) {
  const headers: Record<string, string> = {};
  if (opts?.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;

  const res = await api.delete(path, { headers });
  const status = opts?.expectStatus ?? 200;
  expect(res.status(), `DELETE ${path} → ${res.status()}`).toBe(status);
  return res.json();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Log in via NextAuth credentials provider and store the session cookie.
 * Works by posting to the CSRF-protected credentials callback.
 */
export async function login(page: Page) {
  // Navigate to sign-in page to get CSRF token cookie
  await page.goto("/");

  // Get CSRF token from the NextAuth csrf endpoint
  const csrfRes = await page.request.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  // Submit credentials via NextAuth callback
  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email: TEST_USER.email,
      password: TEST_USER.password,
      csrfToken,
    },
  });
}

/**
 * Create an authenticated API request context with session cookies.
 */
export async function loginViaApi(api: APIRequestContext) {
  // Get CSRF token
  const csrfRes = await api.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  // Log in
  await api.post("/api/auth/callback/credentials", {
    form: {
      email: TEST_USER.email,
      password: TEST_USER.password,
      csrfToken,
    },
  });
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/** Generate a unique name with a timestamp suffix for test isolation. */
export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
