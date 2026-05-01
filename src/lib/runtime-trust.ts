export type RuntimeTrustLevel = "healthy" | "degraded" | "untrusted" | "unknown";

export interface RuntimeTrustReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface RuntimeTrustSummary {
  level: RuntimeTrustLevel;
  reasons: RuntimeTrustReason[];
  lastPingAt: string | null;
  staleSeconds: number | null;
  hasCapabilitySnapshot: boolean;
}

export interface RuntimeTrustInput {
  gatewayUrl?: string | null;
  httpUrl?: string | null;
  status?: string | null;
  lastPing?: Date | string | null;
  metadata?: unknown;
}

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export function deriveRuntimeTrustSummary(
  runtime: RuntimeTrustInput,
  options: { now?: Date; staleAfterMs?: number } = {}
): RuntimeTrustSummary {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const reasons: RuntimeTrustReason[] = [];
  const lastPingAt = toIsoString(runtime.lastPing);
  const staleSeconds = lastPingAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastPingAt)) / 1000))
    : null;

  if (!runtime.gatewayUrl) {
    reasons.push({
      code: "missing_gateway_url",
      severity: "error",
      message: "Runtime is missing a gateway URL.",
    });
  } else if (!isValidUrl(runtime.gatewayUrl, ["ws:", "wss:", "http:", "https:"])) {
    reasons.push({
      code: "invalid_gateway_url",
      severity: "error",
      message: "Runtime gateway URL is not a valid gateway endpoint.",
    });
  }

  if (!runtime.httpUrl) {
    reasons.push({
      code: "missing_http_url",
      severity: "warning",
      message: "Runtime is missing an HTTP URL for diagnostics and callbacks.",
    });
  } else if (!isValidUrl(runtime.httpUrl, ["http:", "https:"])) {
    reasons.push({
      code: "invalid_http_url",
      severity: "warning",
      message: "Runtime HTTP URL is not a valid HTTP endpoint.",
    });
  }

  if (runtime.status === "error" || runtime.status === "disconnected") {
    reasons.push({
      code: `status_${runtime.status}`,
      severity: "error",
      message: `Runtime status is ${runtime.status}.`,
    });
  } else if (!runtime.status || runtime.status === "unknown") {
    reasons.push({
      code: "status_unknown",
      severity: "warning",
      message: "Runtime status has not been confirmed.",
    });
  }

  if (!lastPingAt) {
    reasons.push({
      code: "missing_last_ping",
      severity: "warning",
      message: "Runtime has not reported a recent heartbeat.",
    });
  } else if (staleSeconds !== null && staleSeconds * 1000 > staleAfterMs) {
    reasons.push({
      code: "stale_last_ping",
      severity: "warning",
      message: "Runtime heartbeat is stale.",
    });
  }

  const hasCapabilitySnapshot = Boolean(readCapabilitySnapshot(runtime.metadata));
  if (!hasCapabilitySnapshot) {
    reasons.push({
      code: "missing_capability_snapshot",
      severity: "info",
      message: "Runtime capabilities have not been discovered yet.",
    });
  }

  return {
    level: levelForReasons(reasons),
    reasons,
    lastPingAt,
    staleSeconds,
    hasCapabilitySnapshot,
  };
}

function levelForReasons(reasons: RuntimeTrustReason[]): RuntimeTrustLevel {
  if (reasons.some((reason) => reason.severity === "error")) return "untrusted";
  if (reasons.some((reason) => reason.severity === "warning")) return "degraded";
  if (reasons.length > 0) return "unknown";
  return "healthy";
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function isValidUrl(value: string, protocols: string[]) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function readCapabilitySnapshot(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const snapshot = (metadata as Record<string, unknown>).capabilitySnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}
