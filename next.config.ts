import type { NextConfig } from "next";
import { existsSync, readFileSync } from "fs";
import { networkInterfaces } from "os";
import path from "path";

// Auto-generate AUTH_SECRET for local dev if not set
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "development") {
  process.env.AUTH_SECRET = "crewcmd-local-dev-secret-do-not-use-in-production";
}

function tryReadHostname(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function getManifestHostnames(): string[] {
  const hostnames = new Set<string>();
  const manifestPath = process.env.CREWCMD_MOBILE_MANIFEST
    ? path.resolve(process.cwd(), process.env.CREWCMD_MOBILE_MANIFEST)
    : path.join(process.cwd(), "docs", "examples", "mobile", "org.mobile.local.json");

  if (!existsSync(manifestPath)) {
    return [];
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      server?: { defaultBaseUrl?: string };
    };
    const hostname = tryReadHostname(manifest.server?.defaultBaseUrl);
    if (hostname) {
      hostnames.add(hostname);
    }
  } catch {
    // Ignore malformed local manifests during startup.
  }

  return [...hostnames];
}

/**
 * Auto-detect all network interface IPs (LAN, Tailscale, etc.)
 * plus any configured DNS hostnames so external devices can access the dev
 * server without hardcoding addresses into next.config.
 */
function getDevOrigins(): string[] {
  const origins = new Set<string>();
  const interfaces = networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.add(addr.address);
      }
    }
  }

  for (const hostname of [
    tryReadHostname(process.env.NEXT_PUBLIC_APP_URL),
    tryReadHostname(process.env.NEXTAUTH_URL),
    tryReadHostname(process.env.CREWCMD_BASE_URL),
    ...getManifestHostnames(),
  ]) {
    if (hostname) origins.add(hostname);
  }

  return [...origins];
}

const nextConfig: NextConfig = {
  // Standalone output bundles node_modules into .next/standalone for Docker
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  allowedDevOrigins: getDevOrigins(),
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || "0.1.0",
  },
};

export default nextConfig;
