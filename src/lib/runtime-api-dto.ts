export function toBrowserSafeRuntime<
  T extends Record<string, unknown> & { authToken?: unknown },
>(runtime: T): Omit<T, "authToken"> & { hasAuthToken: boolean } {
  const { authToken, ...safeRuntime } = runtime;
  return {
    ...safeRuntime,
    hasAuthToken: typeof authToken === "string" && authToken.length > 0,
  };
}
