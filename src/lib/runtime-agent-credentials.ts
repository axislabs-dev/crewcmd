const RUNTIME_AUTH_HEADERS = new Set([
  "authorization",
  "xopenclawtoken",
]);

/**
 * Build the in-memory adapter configuration for a runtime-linked agent.
 * Runtime authentication is authoritative and is never read from the agent row.
 */
export function resolveRuntimeAgentAdapterConfig(
  adapterConfig: unknown,
  authToken: string | null,
): Record<string, unknown> {
  const source = isRecord(adapterConfig) ? adapterConfig : {};
  const resolved: Record<string, unknown> = { ...source };
  const headers: Record<string, string> = {};

  if (isRecord(source.headers)) {
    for (const [key, value] of Object.entries(source.headers)) {
      if (RUNTIME_AUTH_HEADERS.has(normalizeHeaderName(key))) continue;
      if (typeof value === "string") headers[key] = value;
    }
  }

  const token = authToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  if (Object.keys(headers).length > 0) {
    resolved.headers = headers;
  } else {
    delete resolved.headers;
  }

  return resolved;
}

function normalizeHeaderName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
