import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_VISUAL_SETTINGS,
  normalizeAgentVisualSettings,
  readAgentVisualSettings,
  readTeamVisualSettings,
  resolveAgentVisualAccentColor,
  resolveAgentVisualSettings,
} from "./agent-visual-settings";

describe("agent visual settings", () => {
  it("normalizes missing and invalid visual settings to defaults", () => {
    expect(normalizeAgentVisualSettings(null)).toEqual(DEFAULT_AGENT_VISUAL_SETTINGS);
    expect(normalizeAgentVisualSettings({
      styleId: "plugin:missing/future-style",
      accent: "invalid",
      accentColor: "red",
      intensity: "extreme",
    })).toEqual(DEFAULT_AGENT_VISUAL_SETTINGS);
  });

  it("keeps supported built-in style, accent, custom color, and intensity", () => {
    expect(normalizeAgentVisualSettings({
      styleId: "builtin:command-core",
      accent: "custom",
      accentColor: "#12A0ff",
      intensity: "vivid",
    })).toEqual({
      styleId: "builtin:command-core",
      accent: "custom",
      accentColor: "#12A0ff",
      intensity: "vivid",
    });
  });

  it("reads team and agent visual settings from their persisted containers", () => {
    expect(readTeamVisualSettings({
      agentStyle: {
        visual: {
          styleId: "builtin:hologram-waveform",
          accent: "team",
        },
      },
    })).toMatchObject({ styleId: "builtin:hologram-waveform", accent: "team" });

    expect(readAgentVisualSettings({
      visual: {
        styleId: "builtin:neural-constellation",
        intensity: "calm",
      },
    })).toMatchObject({ styleId: "builtin:neural-constellation", intensity: "calm" });
  });

  it("resolves visual settings by session, agent, team, then default precedence", () => {
    const team = { styleId: "builtin:command-core" };
    const agent = { styleId: "builtin:hologram-waveform" };
    const session = { styleId: "builtin:neural-constellation" };

    expect(resolveAgentVisualSettings({ team }).styleId).toBe("builtin:command-core");
    expect(resolveAgentVisualSettings({ agent, team }).styleId).toBe("builtin:hologram-waveform");
    expect(resolveAgentVisualSettings({ session, agent, team }).styleId).toBe("builtin:neural-constellation");
    expect(resolveAgentVisualSettings({}).styleId).toBe(DEFAULT_AGENT_VISUAL_SETTINGS.styleId);
  });

  it("resolves accent colors from custom, team, agent, then fallback", () => {
    expect(resolveAgentVisualAccentColor({
      settings: { accent: "custom", accentColor: "#112233" },
      agentColor: "#445566",
      teamColor: "#778899",
    })).toBe("#112233");

    expect(resolveAgentVisualAccentColor({
      settings: { accent: "team" },
      agentColor: "#445566",
      teamColor: "#778899",
    })).toBe("#778899");

    expect(resolveAgentVisualAccentColor({
      settings: { accent: "agent" },
      agentColor: "#445566",
      teamColor: "#778899",
    })).toBe("#445566");

    expect(resolveAgentVisualAccentColor({
      settings: { accent: "agent" },
      agentColor: "not-a-color",
      teamColor: null,
    })).toBe("#63b7aa");
  });
});
