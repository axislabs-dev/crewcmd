"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskCard, CreateTaskCard, extractTaskCards } from "./task-card";

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

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
    </svg>
  );
}

function MessageActions({ content, showSpeak, mobileVisible }: { content: string; showSpeak: boolean; mobileVisible: boolean }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  }, [content]);

  const handleSpeak = useCallback(() => {
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      return;
    }

    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const text = stripMarkdown(content);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.15;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => /samantha|karen|daniel/i.test(v.name));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [content, speaking]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (speaking) window.speechSynthesis?.cancel();
    };
  }, [speaking]);

  const btnClass =
    "p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-white/5 transition-colors cursor-pointer";

  return (
    <div className={`absolute -top-3 right-2 flex items-center gap-0.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)]/90 backdrop-blur-sm px-1 py-0.5 transition-opacity duration-150 z-10 ${mobileVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"} group-hover:opacity-100 group-hover:pointer-events-auto`}>
      <button onClick={handleCopy} aria-label="Copy message" className={btnClass}>
        {copied ? <CheckIcon className="h-4 w-4 text-green-400" /> : <CopyIcon className="h-4 w-4" />}
      </button>
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

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  metadata?: { attachments?: Attachment[] } | null;
}

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

export function ChatMessage({ role, content, isStreaming, metadata }: ChatMessageProps) {
  const isUser = role === "user";
  const attachments = metadata?.attachments;
  const [showActions, setShowActions] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

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
    <div
      className={`flex gap-3 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs ${
          isUser
            ? "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
            : "border-neo/20 bg-neo/10 text-[var(--accent)]"
        }`}
        style={
          !isUser
            ? { boxShadow: "0 0 12px rgba(0, 240, 255, 0.15)" }
            : undefined
        }
      >
        {isUser ? "YOU" : "AI"}
      </div>

      {/* Message bubble */}
      <div
        ref={bubbleRef}
        className="group relative max-w-[85%]"
        onTouchEnd={() => setShowActions((v) => !v)}
      >
        <MessageActions content={content} showSpeak={!isUser} mobileVisible={showActions} />
        <div
          className={`overflow-hidden rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
            isUser
              ? "bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-medium)]"
              : "bg-neo/[0.06] text-[var(--text-primary)] border border-neo/10"
          }`}
        >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_pre]:bg-black/30 [&_pre]:border [&_pre]:border-[var(--border-medium)] [&_pre]:rounded-lg [&_code]:text-neo/80 [&_code]:text-[12px] [&_a]:text-neo [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            {content.includes("<!--task_card") || content.includes("<!--action:create_task:") ? (
              extractTaskCards(content).segments.map((seg, i) =>
                seg.type === "task" ? (
                  <TaskCard key={i} task={seg.task} />
                ) : seg.type === "action_create_task" ? (
                  <CreateTaskCard key={i} suggestion={seg.suggestion} />
                ) : (
                  <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                    {(seg as { type: "text"; content: string }).content}
                  </ReactMarkdown>
                )
              )
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
          <span className="inline-block w-2 h-4 ml-1 bg-neo/60 animate-pulse rounded-sm" />
        )}
        </div>
      </div>
    </div>
  );
}
