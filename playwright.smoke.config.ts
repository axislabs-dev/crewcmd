import { defineConfig } from "@playwright/test";

const smokePort = process.env.SMOKE_PORT ?? "3101";
const smokeBaseURL = process.env.SMOKE_BASE_URL ?? `http://localhost:${smokePort}`;
const smokeDataDir = process.env.SMOKE_PGLITE_DATA_DIR ?? ".data/e2e-onboarding-pglite";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "onboarding-smoke.spec.ts",
  outputDir: "test-results/onboarding-smoke",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: smokeBaseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `rm -rf ${smokeDataDir} && node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start`,
    url: smokeBaseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      PORT: smokePort,
      BASE_URL: smokeBaseURL,
      NEXT_PUBLIC_APP_URL: smokeBaseURL,
      CREWCMD_PGLITE_DATA_DIR: smokeDataDir,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "crewcmd-onboarding-smoke-secret",
      AUTH_URL: smokeBaseURL,
    },
  },
});
