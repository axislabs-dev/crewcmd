#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const nextArgs = args.filter((arg) => arg !== "--dry-run");

function fail(message) {
  console.error(`\nTailscale development setup failed: ${message}\n`);
  process.exit(1);
}

function resolvePort(value) {
  const port = Number.parseInt(value || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`PORT must be an integer between 1 and 65535. Received: ${value}`);
  }
  return port;
}

function normalizePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`CREWCMD_TAILSCALE_URL must be a complete HTTPS URL. Received: ${value}`);
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("CREWCMD_TAILSCALE_URL must be an HTTPS origin without credentials, a path, query, or fragment.");
  }

  return url.origin;
}

function discoverPublicUrl() {
  if (process.env.CREWCMD_TAILSCALE_URL) {
    return normalizePublicUrl(process.env.CREWCMD_TAILSCALE_URL);
  }

  const status = spawnSync("tailscale", ["status", "--json"], {
    encoding: "utf8",
  });
  if (status.error?.code === "ENOENT") {
    fail("the Tailscale CLI is not installed or is not on PATH.");
  }
  if (status.status !== 0) {
    fail(status.stderr.trim() || "unable to read Tailscale status.");
  }

  let payload;
  try {
    payload = JSON.parse(status.stdout);
  } catch {
    fail("Tailscale returned an invalid status response.");
  }

  const dnsName = typeof payload?.Self?.DNSName === "string"
    ? payload.Self.DNSName.trim().replace(/\.$/, "")
    : "";
  if (!dnsName) {
    fail("this device has no Tailscale DNS name. Enable MagicDNS or set CREWCMD_TAILSCALE_URL.");
  }

  return normalizePublicUrl(`https://${dnsName}`);
}

const port = resolvePort(process.env.PORT);
const publicUrl = discoverPublicUrl();
const localTarget = `http://127.0.0.1:${port}`;

console.log(`\nCrewCMD Tailscale origin: ${publicUrl}`);
console.log(`Local Next.js target: ${localTarget}`);
console.log("AUTH_URL and NEXT_PUBLIC_APP_URL will both use the Tailscale origin.");

if (dryRun) {
  console.log("Dry run complete; Tailscale Serve and Next.js were not changed.\n");
  process.exit(0);
}

const serve = spawnSync("tailscale", ["serve", "--bg", "--yes", localTarget], {
  stdio: "inherit",
});
if (serve.error?.code === "ENOENT") {
  fail("the Tailscale CLI is not installed or is not on PATH.");
}
if (serve.status !== 0) {
  fail(`tailscale serve exited with status ${serve.status ?? "unknown"}.`);
}

console.log(`\nStarting CrewCMD at ${publicUrl}`);
console.log("Use this same origin as the Capacitor manifest's server.defaultBaseUrl.\n");

const nextBin = require.resolve("next/dist/bin/next");
const next = spawnSync(
  process.execPath,
  [nextBin, "dev", "--turbopack", "--hostname", "0.0.0.0", "--port", String(port), ...nextArgs],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      AUTH_URL: publicUrl,
      NEXT_PUBLIC_APP_URL: publicUrl,
      PORT: String(port),
    },
  },
);

if (next.error) {
  fail(next.error.message);
}
if (next.signal) {
  process.kill(process.pid, next.signal);
}
process.exit(next.status ?? 0);
