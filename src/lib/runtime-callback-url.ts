import { detectCallbackUrl } from "./detect-callback-url";

export interface RuntimeMetadata {
  callbackBaseUrl?: string;
  devicePrivateKeyPem?: string;
  [key: string]: unknown;
}

function shouldForceHttps(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return false;
  }
  return true;
}

function normalizeCallbackBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" && shouldForceHttps(parsed.hostname)) {
      parsed.protocol = "https:";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function getRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return normalizeCallbackBaseUrl(`${forwardedProto}://${forwardedHost}`);
  }

  const host = request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const proto = forwardedProto || (shouldForceHttps(host.split(":")[0] || host) ? "https" : new URL(request.url).protocol.replace(":", ""));
    return normalizeCallbackBaseUrl(`${proto}://${host}`);
  }

  return normalizeCallbackBaseUrl(new URL(request.url).origin);
}

export function resolveRuntimeCallbackUrl(params: {
  request?: Request;
  runtime?: { gatewayUrl: string; metadata?: Record<string, unknown> | null };
}): string {
  const stored = params.runtime?.metadata?.callbackBaseUrl;
  if (typeof stored === "string" && stored.trim()) {
    return normalizeCallbackBaseUrl(stored);
  }

  const explicit =
    process.env.CREWCMD_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (explicit.trim()) {
    return normalizeCallbackBaseUrl(explicit);
  }

  if (params.request) {
    return getRequestOrigin(params.request);
  }

  if (!params.runtime?.gatewayUrl) {
    return "http://localhost:3000";
  }

  return normalizeCallbackBaseUrl(detectCallbackUrl(params.runtime.gatewayUrl));
}
