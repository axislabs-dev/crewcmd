import { defineConfig } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "3100";
const e2eBaseURL = process.env.BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const e2eDataDir = process.env.CREWCMD_PGLITE_DATA_DIR ?? ".data/e2e-pglite";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: e2eBaseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  globalSetup: "./e2e/setup/global-setup.ts",
  webServer: {
    command: `rm -rf ${e2eDataDir} && (pnpm db:seed || test "$?" = "100") && pnpm dev`,
    url: e2eBaseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: e2ePort,
      BASE_URL: e2eBaseURL,
      NEXT_PUBLIC_APP_URL: e2eBaseURL,
      CREWCMD_PGLITE_DATA_DIR: e2eDataDir,
    },
  },
});
