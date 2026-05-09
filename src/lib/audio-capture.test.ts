import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildMediaRecorderOptions,
  getAudioBlobType,
  getAudioFilename,
  getAudioFilenameForMime,
  selectAudioRecorderFormat,
} from "./audio-capture";

describe("audio capture format selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers opus webm when the browser supports it", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (mimeType: string) => mimeType === "audio/webm;codecs=opus",
    });

    expect(selectAudioRecorderFormat()).toEqual({
      mimeType: "audio/webm;codecs=opus",
      extension: "webm",
    });
  });

  it("falls back to mp4/m4a for iOS-style MediaRecorder support", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (mimeType: string) => mimeType === "audio/mp4",
    });

    expect(selectAudioRecorderFormat()).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
  });

  it("omits MediaRecorder options when support cannot be detected", () => {
    vi.stubGlobal("MediaRecorder", undefined);

    const format = selectAudioRecorderFormat();

    expect(format).toEqual({ extension: "webm" });
    expect(buildMediaRecorderOptions(format)).toBeUndefined();
  });

  it("uses the actual recorder mime type for blob uploads", () => {
    expect(getAudioBlobType("audio/mp4", { mimeType: "audio/webm", extension: "webm" })).toBe("audio/mp4");
    expect(getAudioFilename({ mimeType: "audio/mp4", extension: "m4a" })).toBe("audio.m4a");
    expect(getAudioFilenameForMime("audio/mp4;codecs=mp4a.40.2")).toBe("audio.m4a");
  });
});
