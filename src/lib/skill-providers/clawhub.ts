import type { MarketplaceSkill } from "@/lib/skill-providers/catalog";
import type { SkillProviderTrust, SkillProviderUpdate } from "@/lib/skill-provider-types";

const DEFAULT_CLAWHUB_REGISTRY_URL = "https://clawhub.ai";
const DEFAULT_TIMEOUT_MS = 5000;

export interface ClawhubCatalogConfig {
  enabled: boolean;
  registryUrl: string;
  token?: string;
  timeoutMs: number;
}

interface ClawhubFetchParams {
  query?: string;
  limit?: number;
  cursor?: string;
  config?: ClawhubCatalogConfig;
  fetchImpl?: typeof fetch;
}

export interface ClawhubCatalogPage {
  skills: MarketplaceSkill[];
  nextCursor?: string | null;
}

type ClawhubEntry = Record<string, unknown>;

export function getClawhubCatalogConfig(env: Record<string, string | undefined> = process.env): ClawhubCatalogConfig {
  const enabled = env.CREWCMD_CLAWHUB_CATALOG_ENABLED === "true";
  const registryUrl =
    env.CREWCMD_CLAWHUB_CATALOG_URL ||
    env.OPENCLAW_CLAWHUB_URL ||
    env.CLAWHUB_URL ||
    DEFAULT_CLAWHUB_REGISTRY_URL;
  const token = env.CREWCMD_CLAWHUB_TOKEN || env.OPENCLAW_CLAWHUB_TOKEN || env.CLAWHUB_TOKEN || env.CLAWHUB_AUTH_TOKEN;
  const timeoutMs = Number(env.CREWCMD_CLAWHUB_CATALOG_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    enabled,
    registryUrl: normalizeRegistryUrl(registryUrl),
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

export async function fetchClawhubCatalog(params: ClawhubFetchParams = {}): Promise<MarketplaceSkill[] | null> {
  const page = await fetchClawhubCatalogPage(params);
  return page && page.skills.length > 0 ? page.skills : null;
}

export async function fetchClawhubCatalogPage(params: ClawhubFetchParams = {}): Promise<ClawhubCatalogPage | null> {
  const config = params.config ?? getClawhubCatalogConfig();
  if (!config.enabled) return null;

  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = buildCatalogUrl(config.registryUrl, params.query, params.limit, params.cursor);
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const entries = extractClawhubEntries(data);
    const skills = entries
      .map((entry) => normalizeClawhubEntry(entry, config.registryUrl))
      .filter((skill): skill is MarketplaceSkill => Boolean(skill));

    return {
      skills,
      nextCursor: extractNextCursor(data),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeClawhubEntry(entry: ClawhubEntry, registryUrl = DEFAULT_CLAWHUB_REGISTRY_URL): MarketplaceSkill | null {
  const slug = readString(entry, ["slug", "id", "name"]);
  const name = readString(entry, ["name", "displayName", "title"]) || slug;

  if (!slug || !name) return null;

  const version = readString(entry, ["version", "latestVersion", "latest_version"]) || "0.0.0";
  const ownerHandle = readNestedString(entry, ["owner", "handle"]) || readString(entry, ["owner", "publisher", "author"]);
  const sourceUrl = readString(entry, ["sourceUrl", "source_url", "url", "htmlUrl", "html_url"]) || `${registryUrl}/skills/${slug}`;
  const trust = normalizeTrustMetadata(entry);
  const update = normalizeUpdateMetadata(entry, version);

  return {
    name,
    slug,
    description: readString(entry, ["description", "summary"]) || "",
    source: "clawhub",
    version,
    sourceUrl,
    metadata: {
      provider: {
        id: "clawhub",
        skillId: slug,
        registryUrl,
        sourceUrl,
        ownerHandle,
        version,
      },
      trust,
      update,
      supportsScripts: readBoolean(entry, ["supportsScripts", "supports_scripts", "hasScripts", "has_scripts"]) ?? false,
    },
  };
}

function buildCatalogUrl(registryUrl: string, query?: string, limit?: number, cursor?: string): string {
  if (query?.trim()) {
    const url = new URL("/api/v1/search", registryUrl);
    url.searchParams.set("q", query.trim());
    if (limit && limit > 0) url.searchParams.set("limit", String(limit));
    if (cursor?.trim()) url.searchParams.set("cursor", cursor.trim());
    return url.toString();
  }

  const url = new URL("/api/v1/skills", registryUrl);
  if (limit && limit > 0) url.searchParams.set("limit", String(limit));
  if (cursor?.trim()) url.searchParams.set("cursor", cursor.trim());
  return url.toString();
}

function extractClawhubEntries(data: unknown): ClawhubEntry[] {
  if (Array.isArray(data)) return data.filter(isObject);
  if (!isObject(data)) return [];

  for (const key of ["skills", "items", "results", "data"]) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }

  return [];
}

function extractNextCursor(data: unknown): string | null {
  if (!isObject(data)) return null;
  return readString(data, ["nextCursor", "next_cursor", "cursor"]) ?? null;
}

function normalizeTrustMetadata(entry: ClawhubEntry): SkillProviderTrust {
  const trust = isObject(entry.trust) ? entry.trust : {};
  const rawLevel = readString(trust, ["level"]) || readString(entry, ["trustLevel", "trust_level"]);
  const isOfficial = readBoolean(trust, ["isOfficial", "official"]) ?? readBoolean(entry, ["isOfficial", "official"]) ?? false;
  const level = isKnownTrustLevel(rawLevel) ? rawLevel : isOfficial ? "official" : "community";

  return {
    level,
    isOfficial,
    verificationTier: readString(trust, ["verificationTier", "verification_tier"]) || readString(entry, ["verificationTier", "verification_tier"]),
    scanStatus: readString(trust, ["scanStatus", "scan_status"]) || readString(entry, ["scanStatus", "scan_status"]),
    sourceRepo: readString(trust, ["sourceRepo", "source_repo"]) || readString(entry, ["sourceRepo", "source_repo", "repository"]),
    sourceCommit: readString(trust, ["sourceCommit", "source_commit"]) || readString(entry, ["sourceCommit", "source_commit"]),
    hasProvenance: readBoolean(trust, ["hasProvenance", "has_provenance"]) ?? readBoolean(entry, ["hasProvenance", "has_provenance"]),
    warnings: readStringArray(trust.warnings) || readStringArray(entry.warnings) || [],
  };
}

function normalizeUpdateMetadata(entry: ClawhubEntry, version: string): SkillProviderUpdate {
  const update = isObject(entry.update) ? entry.update : {};
  const latestVersion = readString(update, ["latestVersion", "latest_version"]) || readString(entry, ["latestVersion", "latest_version"]) || version;

  return {
    status: "not-installed",
    latestVersion,
  };
}

function normalizeRegistryUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function readString(obj: ClawhubEntry, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function readNestedString(obj: ClawhubEntry, keys: string[]): string | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function readBoolean(obj: ClawhubEntry, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function isObject(value: unknown): value is ClawhubEntry {
  return typeof value === "object" && value !== null;
}

function isKnownTrustLevel(value: string | undefined): value is SkillProviderTrust["level"] {
  return value === "official" || value === "verified" || value === "community" || value === "private" || value === "unknown" || value === "untrusted";
}
