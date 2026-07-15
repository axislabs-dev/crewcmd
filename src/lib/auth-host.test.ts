import { describe, expect, it } from "vitest";
import { resolveAuthOrigin, trustConfiguredAuthHost } from "./auth-host";

describe("production Auth.js host trust", () => {
  it("keeps local development zero-config", () => {
    expect(trustConfiguredAuthHost({ NODE_ENV: "development" })).toBe(true);
  });

  it("requires AUTH_URL in production", () => {
    expect(trustConfiguredAuthHost({
      NODE_ENV: "production",
      AUTH_TRUST_HOST: "true",
      NEXT_PUBLIC_APP_URL: "https://crewcmd.example.com",
    })).toBe(false);
  });

  it.each([
    "http://localhost:3000",
    "https://crewcmd.example.com",
    "https://crewcmd.example.com:8443/",
  ])("accepts the canonical HTTP(S) origin %s", (authUrl) => {
    expect(resolveAuthOrigin({ NODE_ENV: "production", AUTH_URL: authUrl })).toBe(
      new URL(authUrl).origin,
    );
    expect(trustConfiguredAuthHost({
      NODE_ENV: "production",
      AUTH_URL: authUrl,
    })).toBe(true);
  });

  it.each([
    "not-a-url",
    "ftp://crewcmd.example.com",
    "https://user:password@crewcmd.example.com",
    "https://crewcmd.example.com/api/auth",
    "https://crewcmd.example.com?tenant=one",
    "https://crewcmd.example.com#auth",
  ])("rejects the non-canonical AUTH_URL %s", (authUrl) => {
    expect(resolveAuthOrigin({ NODE_ENV: "production", AUTH_URL: authUrl })).toBeNull();
    expect(trustConfiguredAuthHost({
      NODE_ENV: "production",
      AUTH_URL: authUrl,
    })).toBe(false);
  });
});
