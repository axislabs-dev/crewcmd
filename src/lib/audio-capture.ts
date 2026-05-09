export type AudioRecorderFormat = {
  mimeType?: string;
  extension: string;
};

const AUDIO_RECORDER_FORMATS: AudioRecorderFormat[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/mpeg", extension: "mp3" },
  { mimeType: "audio/wav", extension: "wav" },
];

function getMediaRecorderConstructor(): typeof MediaRecorder | null {
  if (typeof globalThis === "undefined") return null;
  return typeof globalThis.MediaRecorder === "undefined" ? null : globalThis.MediaRecorder;
}

export function selectAudioRecorderFormat(): AudioRecorderFormat {
  const Recorder = getMediaRecorderConstructor();
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") {
    return { extension: "webm" };
  }

  for (const format of AUDIO_RECORDER_FORMATS) {
    if (format.mimeType && Recorder.isTypeSupported(format.mimeType)) {
      return format;
    }
  }

  return { extension: "webm" };
}

export function buildMediaRecorderOptions(format = selectAudioRecorderFormat()): MediaRecorderOptions | undefined {
  return format.mimeType ? { mimeType: format.mimeType } : undefined;
}

export function getAudioBlobType(recorderMimeType: string | undefined, fallbackFormat = selectAudioRecorderFormat()): string {
  return recorderMimeType || fallbackFormat.mimeType || "audio/webm";
}

export function getAudioFilename(format: AudioRecorderFormat, prefix = "audio"): string {
  return `${prefix}.${format.extension}`;
}

export function getAudioFilenameForMime(mimeType: string | undefined, fallbackFormat = selectAudioRecorderFormat(), prefix = "audio"): string {
  if (mimeType?.includes("mp4") || mimeType?.includes("m4a")) return `${prefix}.m4a`;
  if (mimeType?.includes("mpeg")) return `${prefix}.mp3`;
  if (mimeType?.includes("wav")) return `${prefix}.wav`;
  if (mimeType?.includes("webm")) return `${prefix}.webm`;
  return getAudioFilename(fallbackFormat, prefix);
}

export function createBrowserAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("AudioContext is only available in a browser environment.");
  }

  const audioWindow = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is not available in this browser.");
  }

  return new AudioContextConstructor();
}
