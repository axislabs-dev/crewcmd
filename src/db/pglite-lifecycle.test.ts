import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installPgliteShutdownHandlers } from "./pglite-lifecycle";

class FakeProcess extends EventEmitter {
  readonly pid = 4242;
  readonly kill = vi.fn();
}

describe("PGlite process lifecycle", () => {
  it("closes once before forwarding the first shutdown signal", async () => {
    const target = new FakeProcess();
    let resolveClose!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );

    installPgliteShutdownHandlers({ close }, target);

    target.emit("SIGINT");
    target.emit("SIGTERM");

    expect(close).toHaveBeenCalledTimes(1);
    expect(target.kill).not.toHaveBeenCalled();

    resolveClose();
    await vi.waitFor(() => {
      expect(target.kill).toHaveBeenCalledWith(target.pid, "SIGINT");
    });
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });

  it("forwards shutdown even when closing fails", async () => {
    const target = new FakeProcess();
    const error = new Error("close failed");
    const logger = { error: vi.fn() };

    installPgliteShutdownHandlers(
      { close: vi.fn().mockRejectedValue(error) },
      target,
      logger,
    );

    target.emit("SIGTERM");

    await vi.waitFor(() => {
      expect(target.kill).toHaveBeenCalledWith(target.pid, "SIGTERM");
    });
    expect(logger.error).toHaveBeenCalledWith(
      "[CrewCmd] Failed to close PGlite cleanly",
      error,
    );
  });
});
