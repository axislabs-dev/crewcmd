import { describe, expect, it } from "vitest";
import { deriveRuntimeCapabilitySnapshot } from "./runtime-capabilities";

describe("deriveRuntimeCapabilitySnapshot realtime voice", () => {
  it("marks OpenAI and Google runtimes as realtime voice passthrough candidates", () => {
    const snapshot = deriveRuntimeCapabilitySnapshot({
      config: {
        auth: {
          profiles: {
            openai_main: { provider: "openai", mode: "api-key" },
            google_main: { provider: "google", mode: "oauth" },
          },
        },
      },
    });

    expect(snapshot.realtimeVoice).toMatchObject({
      passthroughCandidate: true,
      likelyProviders: ["google", "openai"],
      configured: false,
      configuredProviders: [],
      transports: ["webrtc-sdp", "json-pcm-websocket", "gateway-relay"],
    });
    expect(snapshot.realtimeVoice?.gatewayMethods).toContain("talk.session.create");
    expect(snapshot.realtimeVoice?.gatewayMethods).toContain("talk.event");
  });

  it("reads explicit realtime talk provider config when present", () => {
    const snapshot = deriveRuntimeCapabilitySnapshot({
      config: {
        talk: {
          realtime: {
            enabled: true,
            providers: ["openai"],
          },
        },
      },
    });

    expect(snapshot.realtimeVoice).toMatchObject({
      passthroughCandidate: true,
      likelyProviders: [],
      configured: true,
      configuredProviders: ["openai"],
    });
  });
});
