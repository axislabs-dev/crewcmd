import { removeRuntimeAuthSecretsFromMetadata } from "./runtime-device-auth";

export function toBrowserSafeRuntimeMetadata(metadata: unknown) {
  return removeRuntimeAuthSecretsFromMetadata(metadata);
}

export function toBrowserSafeRuntime<
  T extends Record<string, unknown> & { authToken?: unknown },
>(runtime: T): Omit<T, "authToken"> & { hasAuthToken: boolean } {
  const { authToken, ...safeRuntime } = runtime;
  return {
    ...safeRuntime,
    ...(Object.hasOwn(safeRuntime, "metadata")
      ? { metadata: toBrowserSafeRuntimeMetadata(safeRuntime.metadata) }
      : {}),
    hasAuthToken: typeof authToken === "string" && authToken.length > 0,
  } as Omit<T, "authToken"> & { hasAuthToken: boolean };
}
