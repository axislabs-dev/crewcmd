type ShutdownSignal = "SIGINT" | "SIGTERM";

interface ClosablePgliteClient {
  close(): Promise<void>;
}

interface ShutdownProcess {
  readonly pid: number;
  on(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener(signal: ShutdownSignal, listener: () => void): unknown;
  kill(pid: number, signal: ShutdownSignal): unknown;
}

interface ShutdownLogger {
  error(message: string, error: unknown): void;
}

/**
 * Close PGlite before allowing Node's normal signal handling to terminate the
 * process. Re-sending the original signal preserves the expected exit status
 * and lets any remaining framework handlers observe the shutdown.
 */
export function installPgliteShutdownHandlers(
  client: ClosablePgliteClient,
  target: ShutdownProcess = process,
  logger: ShutdownLogger = console,
): () => void {
  let closing: Promise<void> | null = null;

  const removeHandlers = () => {
    target.removeListener("SIGINT", handleSigint);
    target.removeListener("SIGTERM", handleSigterm);
  };

  const shutdown = (signal: ShutdownSignal) => {
    if (closing) return;

    closing = client
      .close()
      .catch((error) => {
        logger.error("[CrewCmd] Failed to close PGlite cleanly", error);
      })
      .finally(() => {
        removeHandlers();
        target.kill(target.pid, signal);
      });
  };

  const handleSigint = () => shutdown("SIGINT");
  const handleSigterm = () => shutdown("SIGTERM");

  target.on("SIGINT", handleSigint);
  target.on("SIGTERM", handleSigterm);

  return removeHandlers;
}
