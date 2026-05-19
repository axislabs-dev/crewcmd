import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64, floatToPcm16, pcm16ToFloat, rmsLevel } from "./realtime-voice-audio";

describe("realtime voice audio helpers", () => {
  it("round trips bytes through base64", () => {
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));

    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("converts float samples to pcm16 and back", () => {
    const pcm = floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    const samples = Array.from(pcm16ToFloat(pcm));

    expect(samples[0]).toBeCloseTo(-1, 4);
    expect(samples[2]).toBeCloseTo(0, 4);
    expect(samples[4]).toBeCloseTo(0.9999, 3);
  });

  it("normalizes rms level for visualization", () => {
    expect(rmsLevel(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rmsLevel(new Float32Array([0.05, -0.05, 0.05]))).toBeGreaterThan(0);
  });
});
