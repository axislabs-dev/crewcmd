import type { NextConfig } from "next";

// Auto-generate AUTH_SECRET for local dev if not set
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "development") {
  process.env.AUTH_SECRET = "crewcmd-local-dev-secret-do-not-use-in-production";
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || "0.1.0",
  },
};

export default nextConfig;
