"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskCard, CreateTaskCard, extractTaskCards } from "./task-card";
import { DEFAULT_AGENT_VOICE_SETTINGS, normalizeAgentVoiceSettings, type AgentVoiceSettings } from "@/lib/tts-voices";

/** Strip markdown syntax to produce plain text for TTS */
function stripMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")         // HTML comments
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // links → text
    .replace(/#{1,6}\s+/g, "")                // headings
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2") // bold/italic
    .replace(/~~(.*?)~~/g, "$1")              // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, "")       // inline/fenced code
    .replace(/^\s*[-*+]\s+/gm, "")           // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, "")           // ordered list markers
    .replace(/^\s*>\s+/gm, "")               // blockquotes
    .replace(/\n{2,}/g, ". ")                 // paragraph breaks → pause
    .replace(/\s+/g, " ")
    .trim();
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m0 0a9.004 9.004 0 0 1 5.002-2.584" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
    </svg>
  );
}

function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 18.75 4.5 21v-4.5A7.5 7.5 0 1 1 12 19.5a8.3 8.3 0 0 1-4.5-.75Z" />
    </svg>
  );
}

function PinIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 4.5h4.5l.75 5.25 3 2.25v2.25H6V12l3-2.25.75-5.25Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14.25V21" />
    </svg>
  );
}

function BookmarkIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 3.75H6.75A1.5 1.5 0 0 0 5.25 5.25v15l6.75-3.75 6.75 3.75v-15a1.5 1.5 0 0 0-1.5-1.5Z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
    </svg>
  );
}

function MessageActions({
  content,
  showSpeak,
  mobileVisible,
  onReplyInThread,
  onTogglePin,
  onToggleSaved,
  isPinned,
  isSaved,
  voiceSettings,
}: {
  content: string;
  showSpeak: boolean;
  mobileVisible: boolean;
  onReplyInThread?: () => void;
  onTogglePin?: () => void;
  onToggleSaved?: () => void;
  isPinned?: boolean;
  isSaved?: boolean;
  voiceSettings?: AgentVoiceSettings | null;
}) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsModRef = useRef<"server" | "browser">("server");
  const resolvedVoiceSettings = useMemo(
    () => normalizeAgentVoiceSettings(voiceSettings ?? DEFAULT_AGENT_VOICE_SETTINGS),
    [voiceSettings]
  );

  const handleCopy = useCallback(async () => {
    try {
      // Modern clipboard API (requires HTTPS on mobile)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // Fallback for HTTP / older browsers
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  }, [content]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const handleSpeak = useCallback(async () => {
    if (speaking) {
      stopSpeaking();
      return;
    }

    const text = stripMarkdown(content);
    if (resolvedVoiceSettings.enabled === false || !text) return;
    setSpeaking(true);

    // Try server TTS first unless the selected voice explicitly uses browser speech.
    if (ttsModRef.current === "server" && resolvedVoiceSettings.provider !== "browser" && !resolvedVoiceSettings.preferNative) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: resolvedVoiceSettings }),
        });

        if (res.status === 503) {
          ttsModRef.current = "browser";
        } else if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          await audio.play();
          return;
        }
      } catch {
        ttsModRef.current = "browser";
      }
    }

    // Browser speechSynthesis fallback
    if (!("speechSynthesis" in window)) { setSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = resolvedVoiceSettings.speed ?? 1.15;
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = resolvedVoiceSettings.voiceId || resolvedVoiceSettings.voiceName
      ? voices.find((v) =>
          v.voiceURI === resolvedVoiceSettings.voiceId ||
          v.name === resolvedVoiceSettings.voiceId ||
          v.name === resolvedVoiceSettings.voiceName
        )
      : null;
    const preferred = selectedVoice || voices.find((v) => /samantha|karen|daniel/i.test(v.name))
      || voices.find((v) => v.lang.startsWith("en") && v.localService);
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [content, resolvedVoiceSettings, speaking, stopSpeaking]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const btnClass =
    "flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer";

  return (
    <div
      className={`absolute -top-3 right-2 flex items-center gap-0.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)]/90 backdrop-blur-sm px-1 py-0.5 transition-opacity duration-150 z-10 ${mobileVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"} group-hover:opacity-100 group-hover:pointer-events-auto`}
      onTouchEnd={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={handleCopy} aria-label="Copy message" className={btnClass}>
        {copied ? <CheckIcon className="h-4 w-4 text-green-400" /> : <CopyIcon className="h-4 w-4" />}
      </button>
      {onReplyInThread && (
        <button onClick={onReplyInThread} aria-label="Reply in thread" title="Reply in thread" className={btnClass}>
          <ReplyIcon className="h-5 w-5" />
        </button>
      )}
      {onTogglePin && (
        <button
          onClick={onTogglePin}
          aria-label={isPinned ? "Unpin message" : "Pin message"}
          title={isPinned ? "Unpin message" : "Pin message"}
          className={btnClass}
        >
          <PinIcon className={`h-4 w-4 ${isPinned ? "text-[var(--accent)]" : ""}`} filled={isPinned} />
        </button>
      )}
      {onToggleSaved && (
        <button
          onClick={onToggleSaved}
          aria-label={isSaved ? "Remove from Later" : "Save for later"}
          title={isSaved ? "Remove from Later" : "Save for later"}
          className={btnClass}
        >
          <BookmarkIcon className={`h-4 w-4 ${isSaved ? "text-[var(--accent)]" : ""}`} filled={isSaved} />
        </button>
      )}
      {showSpeak && (
        <button onClick={handleSpeak} aria-label="Read message aloud" className={btnClass}>
          {speaking ? <StopIcon className="h-4 w-4 text-[var(--accent)]" /> : <SpeakerIcon className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

export interface Attachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ChatIdentityDetails {
  type: "person" | "agent";
  title?: string | null;
  status?: string | null;
  currentTask?: string | null;
  model?: string | null;
  runtimeRef?: string | null;
  workspacePath?: string | null;
  profileHref?: string | null;
  command?: string | null;
}

export interface ChatIdentityProfile {
  displayName: string;
  avatarUrl?: string | null;
  emoji?: string | null;
  isUser: boolean;
  details?: ChatIdentityDetails | null;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  timestamp?: string | null;
  metadata?: { attachments?: Attachment[] } | null;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorEmoji?: string | null;
  identityDetails?: ChatIdentityDetails | null;
  onOpenIdentity?: (profile: ChatIdentityProfile) => void;
  onReplyInThread?: () => void;
  onTogglePin?: () => void;
  onToggleSaved?: () => void;
  isPinned?: boolean;
  isSaved?: boolean;
  threadReplyCount?: number;
  threadReplies?: Array<{ id: string; role: "user" | "assistant"; createdAt?: string }>;
  voiceSettings?: AgentVoiceSettings | null;
}

/** Day separator shown between messages on different dates */
export function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = d.toDateString() === today.toDateString();
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const label = isToday
    ? "Today"
    : isYesterday
      ? "Yesterday"
      : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
      <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">{label}</span>
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  );
}

/** Get the date key (YYYY-MM-DD) from a timestamp */
export function getDateKey(timestamp?: string | null): string | null {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleDateString("sv"); // sv locale gives YYYY-MM-DD
  } catch {
    return null;
  }
}

const markdownComponents: Components = {
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageThumbnail({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="h-16 w-16 rounded-md border border-[var(--border-medium)] object-cover cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm cursor-pointer"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[80vh] max-w-[90vw] rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={src}
            download={alt}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-xs text-white backdrop-blur-sm hover:bg-white/20 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </a>
        </div>
      )}
    </>
  );
}

function formatTime(timestamp?: string | null): string | null {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

function MessageAvatar({
  name,
  avatarUrl,
  emoji,
  isUser,
  onClick,
}: {
  name: string;
  avatarUrl?: string | null;
  emoji?: string | null;
  isUser: boolean;
  onClick?: () => void;
}) {
  const fallback = emoji || getInitials(name) || (isUser ? "U" : "A");
  const fallbackClass = emoji ? "text-lg" : "font-mono text-[10px] font-bold";
  const interactiveClass = onClick ? "cursor-pointer hover:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/40" : "cursor-default";

  return (
    <button
      type="button"
      onClick={onClick}
      onTouchEnd={(event) => event.stopPropagation()}
      disabled={!onClick}
      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border transition focus:outline-none ${interactiveClass} ${
        isUser
          ? "rounded-full border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
          : "rounded-lg border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
      }`}
      aria-label={`Open ${name} identity card`}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className={fallbackClass}>{fallback}</span>
      )}
    </button>
  );
}

function IdentityLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 text-[11px] leading-relaxed">
      <span className="font-medium text-[var(--text-tertiary)]">{label}</span>
      <span className="min-w-0 break-words text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}

export function ChatIdentityProfilePanel({
  profile,
  onClose,
}: {
  profile: ChatIdentityProfile;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { displayName, avatarUrl, emoji, isUser, details } = profile;
  const type = details?.type ?? (isUser ? "person" : "agent");
  const fallback = emoji || getInitials(displayName) || (isUser ? "U" : "A");
  const fallbackClass = emoji ? "text-3xl" : "font-mono text-lg font-bold";
  const defaultStatus = isUser ? "Person" : "AI agent";
  const about = details?.currentTask || details?.title || (isUser ? "Workspace member in this chat." : "AI agent available in this chat.");
  const requestClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[85] bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 ease-out sm:bg-transparent sm:backdrop-blur-0 ${visible ? "opacity-100" : "opacity-0"}`}
      role="dialog"
      aria-label={`${displayName} identity card`}
      aria-modal="true"
      onClick={requestClose}
    >
      <section
        className={`absolute inset-x-0 bottom-0 flex h-[calc(100dvh-var(--mobile-safe-top))] flex-col overflow-hidden rounded-t-[28px] border-t border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-[0_-24px_80px_rgba(0,0,0,0.22)] transition-all duration-200 ease-out sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-[380px] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-[var(--theme-shadow-lg)] ${visible ? "translate-y-0 opacity-100 sm:translate-x-0" : "translate-y-8 opacity-0 sm:translate-x-8 sm:translate-y-0"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 pb-4 pt-[max(var(--mobile-safe-top),1rem)] sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={requestClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close profile"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="min-w-0 px-3 text-center text-base font-semibold text-[var(--text-primary)]">
            {type === "agent" ? "App profile" : "Profile"}
          </div>
          <div className="h-11 w-11 shrink-0" aria-hidden="true" />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-4 px-5 py-6">
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border ${
                isUser
                  ? "rounded-full border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
                  : "rounded-2xl border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
              }`}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className={fallbackClass}>{fallback}</span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold leading-tight text-[var(--text-primary)]">{displayName}</h2>
              <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">{details?.title || defaultStatus}</p>
            </div>
          </div>

          <section className="border-y border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-5 py-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">About {displayName}</h3>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">{about}</p>
          </section>

          {details?.command && (
            <section className="border-b border-[var(--border-subtle)] px-5 py-5">
              <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Commands</h3>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface-hover)] text-xl font-semibold text-[var(--text-primary)]">/</div>
                <div className="min-w-0">
                  <div className="font-mono text-[15px] text-[var(--text-primary)]">{details.command}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Send a message to {displayName}</div>
                </div>
              </div>
            </section>
          )}

          <section className="border-b border-[var(--border-subtle)] px-5 py-5">
            <div className="space-y-2.5">
              <IdentityLine label="Type" value={type === "agent" ? "AI agent" : "Person"} />
              <IdentityLine label="Status" value={details?.status} />
              <IdentityLine label="Task" value={details?.currentTask} />
              <IdentityLine label="Model" value={details?.model} />
              <IdentityLine label="Runtime" value={details?.runtimeRef} />
              <IdentityLine label="Workspace" value={details?.workspacePath} />
            </div>
          </section>

          {details?.profileHref && (
            <div className="px-5 py-5">
              <a
                href={details.profileHref}
                className="flex w-full items-center justify-center rounded-lg border border-[var(--border-medium)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
              >
                {type === "agent" ? "Go to agent" : "View profile"}
              </a>
            </div>
          )}

          <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[13px] text-[var(--text-tertiary)]">
            {type === "agent" ? `${displayName} is available in this workspace.` : `${displayName} is in this workspace.`}
          </div>
        </div>
      </section>
    </div>
  );
}
function ThreadAvatar({ role }: { role: "user" | "assistant" }) {
  const isUser = role === "user";

  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-md border text-[8px] font-bold shadow-sm ${
        isUser
          ? "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
          : "border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
      }`}
      aria-hidden="true"
    >
      {isUser ? "YOU" : "AI"}
    </span>
  );
}

function ThreadReplyIndicator({
  replies,
  fallbackCount,
  isUser,
  onOpen,
}: {
  replies: Array<{ id: string; role: "user" | "assistant"; createdAt?: string }>;
  fallbackCount: number;
  isUser: boolean;
  onOpen: () => void;
}) {
  const replyCount = replies.length || fallbackCount;
  if (replyCount <= 0) return null;

  const displayReplies = replies.slice(-3);
  const lastReplyTime = formatTime(replies.at(-1)?.createdAt);
  const label = `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;

  return (
    <button
      onClick={onOpen}
      className={`mt-1.5 flex max-w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[11px] font-medium text-[var(--text-tertiary)] transition hover:bg-white/5 hover:text-[var(--text-primary)] ${
        isUser ? "ml-auto flex-row-reverse text-right" : ""
      }`}
      aria-label={`Open thread with ${label}`}
    >
      {displayReplies.length > 0 && (
        <span className={`flex shrink-0 items-center ${isUser ? "flex-row-reverse" : ""}`}>
          {displayReplies.map((reply, index) => (
            <span
              key={reply.id}
              className={index > 0 ? (isUser ? "-mr-1.5" : "-ml-1.5") : ""}
            >
              <ThreadAvatar role={reply.role} />
            </span>
          ))}
        </span>
      )}
      <span className="min-w-0 truncate">
        <span className="font-semibold text-[var(--accent)]">{label}</span>
        {lastReplyTime && (
          <span className="ml-2 font-normal text-[var(--text-tertiary)]">Last reply {lastReplyTime}</span>
        )}
      </span>
    </button>
  );
}

export function ChatMessage({
  role,
  content,
  isStreaming,
  timestamp,
  metadata,
  authorName,
  authorAvatarUrl,
  authorEmoji,
  identityDetails,
  onOpenIdentity,
  onReplyInThread,
  onTogglePin,
  onToggleSaved,
  isPinned,
  isSaved,
  threadReplyCount,
  threadReplies = [],
  voiceSettings,
}: ChatMessageProps) {
  const isUser = role === "user";
  const displayName = authorName?.trim() || (isUser ? "You" : "Agent");
  const displayTime = formatTime(timestamp);
  const attachments = metadata?.attachments;
  const [showActions, setShowActions] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const messageWidthClass = "max-w-[min(100%,58rem)]";
  const openIdentity = onOpenIdentity
    ? () => onOpenIdentity({
        displayName,
        avatarUrl: authorAvatarUrl,
        emoji: !isUser ? authorEmoji : null,
        isUser,
        details: identityDetails,
      })
    : undefined;

  // Mobile: hide actions when tapping outside the bubble
  useEffect(() => {
    if (!showActions) return;
    function handleTouch(e: TouchEvent | MouseEvent) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener("touchstart", handleTouch);
    document.addEventListener("mousedown", handleTouch);
    return () => {
      document.removeEventListener("touchstart", handleTouch);
      document.removeEventListener("mousedown", handleTouch);
    };
  }, [showActions]);

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <MessageAvatar
        name={displayName}
        avatarUrl={authorAvatarUrl}
        emoji={!isUser ? authorEmoji : null}
        isUser={isUser}
        onClick={openIdentity}
      />

      <div
        ref={bubbleRef}
        className={`group relative min-w-0 ${messageWidthClass}`}
        onTouchEnd={() => setShowActions((v) => !v)}
      >
        <div className="mb-1 flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            onTouchEnd={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openIdentity?.();
            }}
            disabled={!openIdentity}
            className={`truncate text-left text-[13px] font-semibold leading-none text-[var(--text-primary)] transition focus:outline-none ${
              openIdentity ? "hover:text-[var(--accent)] focus:text-[var(--accent)]" : "cursor-default"
            }`}
            aria-label={`Open ${displayName} identity card`}
          >
            {displayName}
          </button>
          {displayTime && (
            <span className="shrink-0 text-[11px] leading-none text-[var(--text-tertiary)]">
              {displayTime}
            </span>
          )}
        </div>
        <MessageActions
          content={content}
          showSpeak={!isUser}
          mobileVisible={showActions}
          onReplyInThread={onReplyInThread}
          onTogglePin={onTogglePin}
          onToggleSaved={onToggleSaved}
          isPinned={isPinned}
          isSaved={isSaved}
          voiceSettings={voiceSettings}
        />
        <div
          className={`relative overflow-hidden text-[13px] leading-relaxed ${
            isUser
              ? "rounded-xl border border-[var(--border-strong)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--text-primary)] shadow-[0_10px_24px_rgba(0,0,0,0.10)]"
              : "rounded-xl border border-[var(--border-medium)] bg-[color-mix(in_srgb,var(--bg-surface)_92%,var(--bg-surface-hover)_8%)] px-5 py-3.5 text-[var(--text-primary)] shadow-[0_14px_34px_rgba(0,0,0,0.10)]"
          }`}
        >
        {!isUser && <div className="absolute bottom-3 left-0 top-3 w-px rounded-full bg-[var(--accent)] opacity-70" aria-hidden="true" />}
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm max-w-none [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:bg-[var(--bg-tertiary)] [&_pre]:border [&_pre]:border-[var(--border-medium)] [&_pre]:rounded-lg [&_pre]:[&_code]:text-[var(--text-primary)] [&_code]:text-[var(--accent)] [&_code]:text-[12px] [&_a]:text-[var(--accent)] [&_a]:no-underline [&_a]:break-words [&_a]:[overflow-wrap:anywhere] hover:[&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            {content.includes("<!--task_card") || content.includes("<!--action:create_task:") ? (
              extractTaskCards(content).segments.map((seg, i) =>
                seg.type === "task" ? (
                  <TaskCard key={i} task={seg.task} />
                ) : seg.type === "action_create_task" ? (
                  <CreateTaskCard key={i} suggestion={seg.suggestion} />
                ) : (
                  <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {(seg as { type: "text"; content: string }).content}
                  </ReactMarkdown>
                )
              )
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            )}
          </div>
        )}

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att, i) =>
              att.mimeType.startsWith("image/") ? (
                <ImageThumbnail key={i} src={att.url} alt={att.filename} />
              ) : (
                <a
                  key={i}
                  href={att.url}
                  download={att.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <span className="truncate max-w-[150px]">{att.filename}</span>
                  <span className="text-[var(--text-tertiary)]">{formatFileSize(att.size)}</span>
                </a>
              )
            )}
          </div>
        )}

        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-[var(--accent)]/70 animate-pulse rounded-sm" />
        )}
        </div>
        {onReplyInThread && (
          <ThreadReplyIndicator
            replies={threadReplies}
            fallbackCount={threadReplyCount ?? 0}
            isUser={false}
            onOpen={onReplyInThread}
          />
        )}
      </div>
    </div>
  );
}
