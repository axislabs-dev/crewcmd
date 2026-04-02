"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

function ImageLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="max-w-full rounded-lg border border-[var(--border-medium)] cursor-pointer hover:opacity-90 transition-opacity"
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

export function ChatMessage({ role, content, isStreaming, metadata }: ChatMessageProps) {
  const isUser = role === "user";
  const attachments = metadata?.attachments;

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
        className={`max-w-[85%] overflow-hidden rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
          isUser
            ? "bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-medium)]"
            : "bg-neo/[0.06] text-[var(--text-primary)] border border-neo/10"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_pre]:bg-black/30 [&_pre]:border [&_pre]:border-[var(--border-medium)] [&_pre]:rounded-lg [&_code]:text-neo/80 [&_code]:text-[12px] [&_a]:text-neo [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att, i) =>
              att.mimeType.startsWith("image/") ? (
                <ImageLightbox key={i} src={att.url} alt={att.filename} />
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
  );
}
