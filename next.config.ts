import type { NextConfig } from "next";
import { networkInterfaces } from "os";

// Auto-generate AUTH_SECRET for local dev if not set
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "development") {
  process.env.AUTH_SECRET = "crewcmd-local-dev-secret-do-not-use-in-production";
}

/**
 * Auto-detect all network interface IPs (LAN, Tailscale, etc.)
 * so any device on the same network or tailnet can access the dev server
 * without hardcoding addresses.
 */
function getDevOrigins(): string[] {
  const origins: string[] = [];
  const interfaces = networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.push(addr.address);
      }
    }
  }
  return origins;
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
