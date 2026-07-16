import { describe, expect, it } from "vitest";
import {
  deriveRealtimeVoiceReadiness,
  microphoneDeniedRealtimeVoiceReadiness,
  unreachableRealtimeVoiceReadiness,
} from "./realtime-voice-readiness";

describe("deriveRealtimeVoiceReadiness", () => {
  it("reports the CrewCMD build flag requirement", () => {
    expect(deriveRealtimeVoiceReadiness({ enabled: false })).toMatchObject({
      status: "disabled",
      fallback: "classic-stt-tts",
      protocolVerified: false,
    });
  });

  it("honors authoritative readiness from OpenClaw 2026.7 catalogs", () => {
    expect(deriveRealtimeVoiceReadiness({
      enabled: true,
      catalog: {
        realtime: {
          ready: true,
          activeProvider: "openai",
          providers: [{
            id: "openai-realtime",
            aliases: ["openai"],
            label: "OpenAI Realtime Voice",
            configured: true,
            transports: ["webrtc", "gateway-relay"],
          }],
        },
      },
    })).toMatchObject({
      status: "ready",
      provider: "openai-realtime",
      availableTransports: ["webrtc", "gateway-relay"],
      protocolVerified: true,
    });
  });

  it("preserves compatibility with the local OpenClaw 2026.6.11 catalog", () => {
    expect(deriveRealtimeVoiceReadiness({
      enabled: true,
      catalog: {
        realtime: {
          activeProvider: "openai",
          providers: [{
            id: "openai",
            label: "OpenAI Realtime Voice",
            configured: true,
            transports: ["webrtc", "gateway-relay"],
          }],
        },
      },
    })).toMatchObject({
      status: "ready",
      provider: "openai",
      protocolVerified: false,
    });
  });

  it("treats current OpenClaw readiness=false as authoritative", () => {
    expect(deriveRealtimeVoiceReadiness({
      enabled: true,
      catalog: {
        realtime: {
          ready: false,
          activeProvider: "openai",
          providers: [{ id: "openai", configured: true, transports: ["gateway-relay"] }],
        },
      },
    })).toMatchObject({
      status: "provider-missing",
      provider: "openai",
      protocolVerified: true,
    });
  });

  it("reports requested providers and unsupported transports", () => {
    expect(deriveRealtimeVoiceReadiness({
      enabled: true,
      requestedProvider: "google",
      catalog: {
        realtime: {
          ready: true,
          activeProvider: "openai",
          providers: [{ id: "openai", configured: true, transports: ["gateway-relay"] }],
        },
      },
    })).toMatchObject({ status: "provider-missing", provider: "google" });

    expect(deriveRealtimeVoiceReadiness({
      enabled: true,
      catalog: {
        realtime: {
          ready: true,
          activeProvider: "openai",
          providers: [{ id: "openai", configured: true, transports: ["webrtc"] }],
        },
      },
    })).toMatchObject({
      status: "unsupported-transport",
      availableTransports: ["webrtc"],
    });
  });
});

describe("realtime readiness client states", () => {
  it("represents unreachable runtimes and denied microphones without secrets", () => {
    const unreachable = unreachableRealtimeVoiceReadiness("connection refused");
    expect(unreachable).toMatchObject({
      status: "unreachable",
      message: expect.stringContaining("connection refused"),
    });

    expect(microphoneDeniedRealtimeVoiceReadiness(unreachable)).toMatchObject({
      status: "microphone-denied",
      fallback: "classic-stt-tts",
    });
  });
});
