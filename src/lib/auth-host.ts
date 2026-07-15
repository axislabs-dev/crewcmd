type AuthHostEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "AUTH_URL" | "AUTH_TRUST_HOST" | "NEXT_PUBLIC_APP_URL" | "NODE_ENV"
>>;

export function resolveAuthOrigin(
  env: AuthHostEnvironment = process.env,
): string | null {
  if (!env.AUTH_URL) return null;

  try {
    const url = new URL(env.AUTH_URL);
    const hasCanonicalPath = url.pathname === "/";
    const hasSupportedProtocol = url.protocol === "http:" || url.protocol === "https:";
    const hasUnsafeComponents = Boolean(
      url.username || url.password || url.search || url.hash,
    );

    if (!hasCanonicalPath || !hasSupportedProtocol || hasUnsafeComponents) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Auth.js must trust request host metadata to operate. Development remains
 * zero-config, while production requires an explicit canonical AUTH_URL.
 * AUTH_TRUST_HOST is intentionally insufficient on its own because it trusts
 * arbitrary forwarded host headers without pinning CrewCMD's public origin.
 */
export function trustConfiguredAuthHost(
  env: AuthHostEnvironment = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return resolveAuthOrigin(env) !== null;
}
