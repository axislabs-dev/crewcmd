const SENSITIVE_CONFIG_KEYS = new Set([
  "auth",
  "authorization",
  "cookie",
  "credentials",
  "envvars",
  "headers",
  "httpauthheader",
  "proxyauthorization",
  "sessionkey",
  "setcookie",
]);

/**
 * Convert a database-backed agent record into a browser-safe response object.
 *
 * Agent configuration is intentionally open-ended because adapters and runtimes
 * may contribute provider-specific fields. Keep the useful shape, but remove
 * values whose keys indicate credentials instead of relying on a short allowlist
 * that can become stale when a new provider is added.
 */
export function toPublicAgentDto<T extends Record<string, unknown>>(agent: T): T {
  return {
    ...agent,
    adapterConfig: sanitizeConfig(agent.adapterConfig),
    runtimeConfig: sanitizeConfig(agent.runtimeConfig),
  };
}

export function sanitizeConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return sanitizeRecord(value);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;

    if (isUrlKey(key) && typeof entry === "string") {
      const safeUrl = sanitizeUrl(entry);
      if (safeUrl !== undefined) sanitized[key] = safeUrl;
      continue;
    }

    if (Array.isArray(entry)) {
      sanitized[key] = entry.map(sanitizeValue);
      continue;
    }

    sanitized[key] = isRecord(entry) ? sanitizeRecord(entry) : entry;
  }

  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  return isRecord(value) ? sanitizeRecord(value) : value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_CONFIG_KEYS.has(normalized)
    || normalized.endsWith("headers")
    || normalized.endsWith("apikey")
    || normalized.endsWith("accesskey")
    || normalized.endsWith("accesstoken")
    || normalized.endsWith("authtoken")
    || normalized.endsWith("bearertoken")
    || normalized.endsWith("clientsecret")
    || normalized.endsWith("credential")
    || normalized.endsWith("password")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("refreshtoken")
    || normalized.endsWith("secret")
    || normalized.endsWith("signingkey")
    || normalized.endsWith("token");
}

function isUrlKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "url" || normalized.endsWith("url");
}

function sanitizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    // Do not echo an unparseable value that resembles a credential-bearing URL.
    return value.includes("@") || value.includes("?") ? undefined : value;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
