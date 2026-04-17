import { detectCallbackUrl } from "./detect-callback-url";

export interface RuntimeMetadata {
  callbackBaseUrl?: string;
  devicePrivateKeyPem?: string;
  [key: string]: unknown;
}

export function getRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function resolveRuntimeCallbackUrl(params: {
  request?: Request;
  runtime?: { gatewayUrl: string; metadata?: Record<string, unknown> | null };
}): string {
  const stored = params.runtime?.metadata?.callbackBaseUrl;
  if (typeof stored === "string" && stored.trim()) {
    return stored.trim().replace(/\/+$/, "");
  }

  const explicit =
    process.env.CREWCMD_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (explicit.trim()) {
    return explicit.trim().replace(/\/+$/, "");
  }

  if (params.request) {
    return getRequestOrigin(params.request).replace(/\/+$/, "");
  }

  if (!params.runtime?.gatewayUrl) {
    return "http://localhost:3000";
  }

  return detectCallbackUrl(params.runtime.gatewayUrl).replace(/\/+$/, "");
}
