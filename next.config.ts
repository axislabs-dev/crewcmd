import type { NextConfig } from "next";

// Auto-generate AUTH_SECRET for local dev if not set
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "development") {
  process.env.AUTH_SECRET = "crewcmd-local-dev-secret-do-not-use-in-production";
}

const nextConfig: NextConfig = {};

export default nextConfig;
