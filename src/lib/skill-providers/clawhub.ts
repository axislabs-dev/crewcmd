import type { MarketplaceSkill } from "@/lib/skill-providers/catalog";
import type {
  SkillProviderTrust,
  SkillProviderUpdate,
} from "@/lib/skill-provider-types";

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
  sort?: string;
  config?: ClawhubCatalogConfig;
  fetchImpl?: typeof fetch;
}

export interface ClawhubCatalogPage {
  skills: MarketplaceSkill[];
  nextCursor?: string | null;
}

type ClawhubEntry = Record<string, unknown>;

export function getClawhubCatalogConfig(
  env: Record<string, string | undefined> = process.env,
): ClawhubCatalogConfig {
  const enabled = env.CREWCMD_CLAWHUB_CATALOG_ENABLED === "true";
  const registryUrl =
    env.CREWCMD_CLAWHUB_CATALOG_URL ||
    env.OPENCLAW_CLAWHUB_URL ||
    env.CLAWHUB_URL ||
    DEFAULT_CLAWHUB_REGISTRY_URL;
  const token =
    env.CREWCMD_CLAWHUB_TOKEN ||
    env.OPENCLAW_CLAWHUB_TOKEN ||
    env.CLAWHUB_TOKEN ||
    env.CLAWHUB_AUTH_TOKEN;
  const timeoutMs = Number(
    env.CREWCMD_CLAWHUB_CATALOG_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  );

  return {
    enabled,
    registryUrl: normalizeRegistryUrl(registryUrl),
    token,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

export async function fetchClawhubCatalog(
  params: ClawhubFetchParams = {},
): Promise<MarketplaceSkill[] | null> {
  const page = await fetchClawhubCatalogPage(params);
  return page && page.skills.length > 0 ? page.skills : null;
}

export async function fetchClawhubCatalogPage(
  params: ClawhubFetchParams = {},
): Promise<ClawhubCatalogPage | null> {
  const config = params.config ?? getClawhubCatalogConfig();
  if (!config.enabled) return null;

  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = buildCatalogUrl(
      config.registryUrl,
      params.query,
      params.limit,
      params.cursor,
      params.sort,
    );
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: config.token
        ? { Authorization: `Bearer ${config.token}` }
        : undefined,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const entries = extractClawhubEntries(data);
    const skills = await hydrateClawhubDetails(
      entries
        .map((entry) => normalizeClawhubEntry(entry, config.registryUrl))
        .filter((skill): skill is MarketplaceSkill => Boolean(skill)),
      { config, fetchImpl: fetchFn },
    );

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

export function normalizeClawhubEntry(
  entry: ClawhubEntry,
  registryUrl = DEFAULT_CLAWHUB_REGISTRY_URL,
): MarketplaceSkill | null {
  const skillEntry = isObject(entry.skill) ? entry.skill : entry;
  const slug =
    readString(entry, ["slug", "id", "name"]) ||
    readString(skillEntry, ["slug", "id", "name"]);
  const name =
    readString(entry, ["name", "displayName", "title"]) ||
    readString(skillEntry, ["name", "displayName", "title"]) ||
    slug;

  if (!slug || !name) return null;

  const latestVersionEntry = isObject(entry.latestVersion)
    ? entry.latestVersion
    : isObject(skillEntry.latestVersion)
      ? skillEntry.latestVersion
      : {};
  const tags = isObject(entry.tags)
    ? entry.tags
    : isObject(skillEntry.tags)
      ? skillEntry.tags
      : {};
  const version =
    readString(entry, ["version", "latestVersion", "latest_version"]) ||
    readString(skillEntry, ["version", "latestVersion", "latest_version"]) ||
    readString(latestVersionEntry, ["version"]) ||
    readString(tags, ["latest"]);
  const ownerHandle =
    readNestedString(entry, ["owner", "handle"]) ||
    readString(entry, ["owner", "publisher", "author"]);
  const sourceUrl =
    readString(entry, [
      "sourceUrl",
      "source_url",
      "url",
      "htmlUrl",
      "html_url",
    ]) || `${registryUrl}/skills/${slug}`;
  const trust = normalizeTrustMetadata(entry);
  const moderation = normalizeModerationMetadata(entry);
  const security = normalizeSecurityMetadata(entry);
  const update = normalizeUpdateMetadata(entry, version ?? "");
  const stats = normalizeStatsMetadata(entry);
  const updatedAt =
    readNumber(entry, ["updatedAt", "updated_at"]) ??
    readNumber(skillEntry, ["updatedAt", "updated_at"]);
  const createdAt =
    readNumber(entry, ["createdAt", "created_at"]) ??
    readNumber(skillEntry, ["createdAt", "created_at"]);

  return {
    name,
    slug,
    description:
      readString(entry, ["description", "summary"]) ||
      readString(skillEntry, ["description", "summary"]) ||
      "",
    source: "clawhub",
    version: version ?? "",
    sourceUrl,
    metadata: {
      provider: {
        id: "clawhub",
        skillId: slug,
        registryUrl,
        sourceUrl,
        ownerHandle,
        version: version ?? undefined,
      },
      trust,
      moderation,
      security,
      update,
      stats,
      updatedAt,
      createdAt,
      supportsScripts:
        readBoolean(entry, [
          "supportsScripts",
          "supports_scripts",
          "hasScripts",
          "has_scripts",
        ]) ?? false,
    },
  };
}

function buildCatalogUrl(
  registryUrl: string,
  query?: string,
  limit?: number,
  cursor?: string,
  sort?: string,
): string {
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
  if (sort?.trim()) url.searchParams.set("sort", sort.trim());
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
  const moderation = isObject(entry.moderation) ? entry.moderation : {};
  const security = isObject(entry.security) ? entry.security : {};
  const rawLevel =
    readString(trust, ["level"]) ||
    readString(security, ["level", "riskLevel", "risk_level"]) ||
    readString(entry, ["trustLevel", "trust_level"]);
  const isOfficial =
    readBoolean(trust, ["isOfficial", "official"]) ??
    readBoolean(entry, ["isOfficial", "official"]) ??
    false;
  const level = isKnownTrustLevel(rawLevel)
    ? rawLevel
    : isOfficial
      ? "official"
      : "community";

  return {
    level,
    isOfficial,
    verificationTier:
      readString(trust, ["verificationTier", "verification_tier"]) ||
      readString(entry, ["verificationTier", "verification_tier"]),
    scanStatus:
      readString(trust, ["scanStatus", "scan_status"]) ||
      readString(security, ["scanStatus", "scan_status", "status"]) ||
      readString(moderation, ["scanStatus", "scan_status", "status"]) ||
      readString(entry, ["scanStatus", "scan_status"]),
    sourceRepo:
      readString(trust, ["sourceRepo", "source_repo"]) ||
      readString(entry, ["sourceRepo", "source_repo", "repository"]),
    sourceCommit:
      readString(trust, ["sourceCommit", "source_commit"]) ||
      readString(entry, ["sourceCommit", "source_commit"]),
    hasProvenance:
      readBoolean(trust, ["hasProvenance", "has_provenance"]) ??
      readBoolean(entry, ["hasProvenance", "has_provenance"]),
    warnings:
      readStringArray(trust.warnings) || readStringArray(entry.warnings) || [],
  };
}

function normalizeModerationMetadata(
  entry: ClawhubEntry,
): Record<string, unknown> | null {
  const moderation = isObject(entry.moderation) ? entry.moderation : null;
  if (!moderation) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of [
    "status",
    "scanStatus",
    "scan_status",
    "result",
    "reviewedAt",
    "reviewed_at",
  ] as const) {
    const value = moderation[key];
    if (typeof value === "string" && value.trim()) normalized[key] = value.trim();
    if (typeof value === "number" && Number.isFinite(value)) normalized[key] = value;
    if (typeof value === "boolean") normalized[key] = value;
  }
  const warnings = readStringArray(moderation.warnings);
  if (warnings) normalized.warnings = warnings;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeSecurityMetadata(
  entry: ClawhubEntry,
): Record<string, unknown> | null {
  const security = isObject(entry.security) ? entry.security : {};
  const moderation = isObject(entry.moderation) ? entry.moderation : {};
  const score =
    readNumber(security, ["score", "securityScore", "security_score"]) ??
    readNumber(moderation, ["score", "securityScore", "security_score"]) ??
    readNumber(entry, ["securityScore", "security_score"]);
  const scanStatus =
    readString(security, ["scanStatus", "scan_status", "status"]) ||
    readString(moderation, ["scanStatus", "scan_status", "status"]) ||
    readString(entry, ["scanStatus", "scan_status"]);
  const level =
    readString(security, ["level", "riskLevel", "risk_level"]) ||
    readString(entry, [
      "securityLevel",
      "security_level",
      "riskLevel",
      "risk_level",
    ]);
  const warnings =
    readStringArray(security.warnings) ||
    readStringArray(moderation.warnings) ||
    readStringArray(entry.warnings);

  const normalized: Record<string, unknown> = {};
  if (score !== undefined) normalized.score = score;
  if (scanStatus) normalized.scanStatus = scanStatus;
  if (level) normalized.level = level;
  if (warnings) normalized.warnings = warnings;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeUpdateMetadata(
  entry: ClawhubEntry,
  version: string,
): SkillProviderUpdate {
  const update = isObject(entry.update) ? entry.update : {};
  const skillEntry = isObject(entry.skill) ? entry.skill : entry;
  const latestVersionEntry = isObject(entry.latestVersion)
    ? entry.latestVersion
    : isObject(skillEntry.latestVersion)
      ? skillEntry.latestVersion
      : {};
  const tags = isObject(entry.tags)
    ? entry.tags
    : isObject(skillEntry.tags)
      ? skillEntry.tags
      : {};
  const latestVersion =
    readString(update, ["latestVersion", "latest_version"]) ||
    readString(entry, ["latestVersion", "latest_version"]) ||
    readString(skillEntry, ["latestVersion", "latest_version"]) ||
    readString(latestVersionEntry, ["version"]) ||
    readString(tags, ["latest"]) ||
    version;

  return {
    status: "not-installed",
    latestVersion,
  };
}

function normalizeStatsMetadata(
  entry: ClawhubEntry,
): Record<string, number> | undefined {
  const skillEntry = isObject(entry.skill) ? entry.skill : entry;
  const stats = isObject(entry.stats)
    ? entry.stats
    : isObject(skillEntry.stats)
      ? skillEntry.stats
      : null;
  if (!stats) return undefined;

  const normalized: Record<string, number> = {};
  for (const key of [
    "downloads",
    "stars",
    "comments",
    "installsAllTime",
    "installsCurrent",
    "versions",
  ] as const) {
    const value = readNumber(stats, [key]);
    if (value !== undefined) normalized[key] = value;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

async function hydrateClawhubDetails(
  skills: MarketplaceSkill[],
  params: { config: ClawhubCatalogConfig; fetchImpl: typeof fetch },
): Promise<MarketplaceSkill[]> {
  const needsDetails = skills.filter(
    (skill) => !skill.version || !hasStats(skill),
  );
  if (needsDetails.length === 0) return skills;

  const details = new Map<string, MarketplaceSkill>();
  await Promise.all(
    needsDetails.map(async (skill) => {
      try {
        const detail = await fetchClawhubSkillDetail(skill.slug, params);
        if (detail) details.set(skill.slug, detail);
      } catch {
        // Keep the lightweight search/list result if detail hydration is unavailable.
      }
    }),
  );

  if (details.size === 0) return skills;
  return skills.map((skill) => {
    const detail = details.get(skill.slug);
    if (!detail) return skill;
    return {
      ...skill,
      version: detail.version || skill.version,
      sourceUrl: detail.sourceUrl || skill.sourceUrl,
      metadata: {
        ...(skill.metadata ?? {}),
        ...(detail.metadata ?? {}),
      },
    };
  });
}

async function fetchClawhubSkillDetail(
  slug: string,
  params: { config: ClawhubCatalogConfig; fetchImpl: typeof fetch },
): Promise<MarketplaceSkill | null> {
  const url = new URL(
    `/api/v1/skills/${encodeURIComponent(slug)}`,
    params.config.registryUrl,
  );
  const res = await params.fetchImpl(url.toString(), {
    headers: params.config.token
      ? { Authorization: `Bearer ${params.config.token}` }
      : undefined,
  });
  if (!res.ok) return null;
  return normalizeClawhubEntry(await res.json(), params.config.registryUrl);
}

function hasStats(skill: MarketplaceSkill): boolean {
  const stats = skill.metadata?.stats;
  return isObject(stats) && Object.keys(stats).length > 0;
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

function readNumber(obj: ClawhubEntry, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readNestedString(
  obj: ClawhubEntry,
  keys: string[],
): string | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" && current.trim()
    ? current.trim()
    : undefined;
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

function isKnownTrustLevel(
  value: string | undefined,
): value is SkillProviderTrust["level"] {
  return (
    value === "official" ||
    value === "verified" ||
    value === "community" ||
    value === "private" ||
    value === "unknown" ||
    value === "untrusted"
  );
}
