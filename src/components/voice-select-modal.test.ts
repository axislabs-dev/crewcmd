import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceSelectModal, filterRealtimeVoiceOptions } from "./voice-select-modal";
import type { TtsVoiceOption } from "@/lib/tts-voices";

const voices: TtsVoiceOption[] = [
  { id: "cedar", name: "Cedar", provider: "openai" },
  { id: "onyx", name: "Onyx", provider: "openai" },
  { id: "Kore", name: "Kore", provider: "google" },
  { id: "custom", name: "Custom", provider: "elevenlabs" },
];

describe("filterRealtimeVoiceOptions", () => {
  it("shows only realtime voices from providers ready in the selected runtime", () => {
    expect(filterRealtimeVoiceOptions(voices, ["openai"])).toEqual([
      { id: "cedar", name: "Cedar", provider: "openai" },
    ]);
    expect(filterRealtimeVoiceOptions(voices, ["google"])).toEqual([
      { id: "Kore", name: "Kore", provider: "google" },
    ]);
  });

  it("shows no realtime choices when the runtime has no ready provider", () => {
    expect(filterRealtimeVoiceOptions(voices, [])).toEqual([]);
  });
});

describe("VoiceSelectModal", () => {
  it("does not autofocus voice search when the picker opens", () => {
    const markup = renderToStaticMarkup(createElement(VoiceSelectModal, {
      open: true,
      onClose: () => {},
      onSelect: () => {},
    }));

    expect(markup).toContain('placeholder="Search voices"');
    expect(markup).not.toContain("autofocus");
  });
});
