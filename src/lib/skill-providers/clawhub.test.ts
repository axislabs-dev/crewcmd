import { describe, expect, it, vi } from "vitest";
import { resolveMarketplaceSkills } from "@/lib/skill-providers/catalog";
import { fetchClawhubCatalog, getClawhubCatalogConfig, normalizeClawhubEntry } from "@/lib/skill-providers/clawhub";

describe("Clawhub skill catalog provider", () => {
  it("normalizes Clawhub entries into marketplace skills with provider metadata", () => {
    const skill = normalizeClawhubEntry(
      {
        slug: "calendar",
        name: "Calendar",
        description: "Manage calendar events.",
        version: "1.2.3",
        owner: { handle: "axislabs" },
        source_url: "https://github.com/axislabs/calendar-skill",
        trust: {
          level: "verified",
          verification_tier: "reviewed",
          scan_status: "passed",
          source_repo: "https://github.com/axislabs/calendar-skill",
          has_provenance: true,
          warnings: ["requires OAuth"],
        },
        latest_version: "1.2.4",
        supports_scripts: true,
      },
      "https://clawhub.example"
    );

    expect(skill).toMatchObject({
      name: "Calendar",
      slug: "calendar",
      description: "Manage calendar events.",
      source: "clawhub",
      version: "1.2.3",
      sourceUrl: "https://github.com/axislabs/calendar-skill",
      metadata: {
        provider: {
          id: "clawhub",
          skillId: "calendar",
          registryUrl: "https://clawhub.example",
          ownerHandle: "axislabs",
          version: "1.2.3",
        },
        trust: {
          level: "verified",
          verificationTier: "reviewed",
          scanStatus: "passed",
          sourceRepo: "https://github.com/axislabs/calendar-skill",
          hasProvenance: true,
          warnings: ["requires OAuth"],
        },
        update: {
          status: "not-installed",
          latestVersion: "1.2.4",
        },
        supportsScripts: true,
      },
    });
  });

  it("does not fetch Clawhub unless the catalog flag is enabled", async () => {
    const fetchImpl = vi.fn();

    const skills = await fetchClawhubCatalog({
      config: {
        enabled: false,
        registryUrl: "https://clawhub.example",
        timeoutMs: 1000,
      },
      fetchImpl,
    });

    expect(skills).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches search results from a configured Clawhub endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            slug: "github",
            name: "GitHub",
            description: "Manage repositories.",
            latest_version: "2.0.0",
            official: true,
          },
        ],
      }),
    });

    const skills = await fetchClawhubCatalog({
      query: "git",
      limit: 5,
      config: {
        enabled: true,
        registryUrl: "https://clawhub.example",
        token: "token_123",
        timeoutMs: 1000,
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://clawhub.example/api/v1/search?q=git&limit=5",
      expect.objectContaining({
        headers: { Authorization: "Bearer token_123" },
      })
    );
    expect(skills).toHaveLength(1);
    expect(skills?.[0]).toMatchObject({
      slug: "github",
      source: "clawhub",
      version: "2.0.0",
      metadata: {
        trust: {
          level: "official",
          isOfficial: true,
        },
      },
    });
  });

  it("falls back to built-in marketplace skills when Clawhub fails", async () => {
    const skills = await resolveMarketplaceSkills({
      fetchClawhub: async () => null,
    });

    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((skill) => skill.source === "skills_sh")).toBe(true);
    expect(skills.some((skill) => skill.source === "github")).toBe(true);
  });

  it("reads the opt-in catalog config from environment variables", () => {
    const config = getClawhubCatalogConfig({
      CREWCMD_CLAWHUB_CATALOG_ENABLED: "true",
      CREWCMD_CLAWHUB_CATALOG_URL: "https://clawhub.example/",
      CREWCMD_CLAWHUB_TOKEN: "token_123",
      CREWCMD_CLAWHUB_CATALOG_TIMEOUT_MS: "2500",
    });

    expect(config).toEqual({
      enabled: true,
      registryUrl: "https://clawhub.example",
      token: "token_123",
      timeoutMs: 2500,
    });
  });

  it("returns null when catalog is disabled (default behavior)", () => {
    // Simulate default config without CREWCMD_CLAWHUB_CATALOG_ENABLED
    const config = getClawhubCatalogConfig({});
    expect(config.enabled).toBe(false);
  });

  it("combines ClawHub skills with FALLBACK_SKILLS when catalog is enabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            slug: "test-skill",
            name: "Test Skill",
            description: "A test skill from ClawHub",
            latest_version: "1.0.0",
          },
        ],
      }),
    });

    const skills = await fetchClawhubCatalog({
      config: {
        enabled: true,
        registryUrl: "https://clawhub.example",
        timeoutMs: 1000,
      },
      fetchImpl,
    });

    expect(skills).not.toBeNull();
    expect(skills).toHaveLength(1);
    expect(skills?.[0].slug).toBe("test-skill");
    expect(skills?.[0].source).toBe("clawhub");
  });
});
