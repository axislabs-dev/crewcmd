"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex gap-3 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-mono ${
          isUser
            ? "border-white/10 bg-white/[0.05] text-white/50"
            : "border-neo/20 bg-neo/10 text-neo"
        }`}
        style={
          !isUser
            ? { boxShadow: "0 0 12px rgba(0, 240, 255, 0.15)" }
            : undefined
        }
      >
        {isUser ? "YOU" : "NEO"}
      </div>

      {/* Message bubble */}
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 font-mono text-[13px] leading-relaxed ${
          isUser
            ? "bg-white/[0.06] text-white/80 border border-white/[0.08]"
            : "bg-neo/[0.06] text-white/85 border border-neo/10"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_pre]:bg-black/30 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_code]:text-neo/80 [&_code]:text-[12px] [&_a]:text-neo [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-neo/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
