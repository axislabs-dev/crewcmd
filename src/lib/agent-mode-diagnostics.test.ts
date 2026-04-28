import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areAgentModeDiagnosticsEnabled,
  createAgentModeSessionId,
  publishAgentModeDiagnostic,
} from "./agent-mode-diagnostics";

describe("agent-mode-diagnostics", () => {
  const originalEnv = process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS;
    } else {
      process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("keeps diagnostics disabled by default", () => {
    delete process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS;

    expect(areAgentModeDiagnosticsEnabled()).toBe(false);
  });

  it("enables server diagnostics from the environment", () => {
    process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS = "1";

    expect(areAgentModeDiagnosticsEnabled()).toBe(true);
  });

  it("only writes diagnostic events when enabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    delete process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS;
    publishAgentModeDiagnostic({ scope: "test", event: "disabled" });
    expect(info).not.toHaveBeenCalled();

    process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS = "1";
    publishAgentModeDiagnostic({ scope: "test", event: "enabled" });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toBe("[agent-mode]");
  });

  it("creates tagged session ids", () => {
    expect(createAgentModeSessionId("soak")).toMatch(/^soak-[a-z0-9]+-[a-z0-9-]+$/);
  });
});
