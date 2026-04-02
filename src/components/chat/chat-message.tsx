"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskCard, extractTaskCards } from "./task-card";

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
        className={`max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
          isUser
            ? "bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-medium)]"
            : "bg-neo/[0.06] text-[var(--text-primary)] border border-neo/10"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_pre]:bg-black/30 [&_pre]:border [&_pre]:border-[var(--border-medium)] [&_pre]:rounded-lg [&_code]:text-neo/80 [&_code]:text-[12px] [&_a]:text-neo [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            {content.includes("<!--task_card") ? (
              extractTaskCards(content).segments.map((seg, i) =>
                seg.type === "task" ? (
                  <TaskCard key={i} task={seg.task} />
                ) : (
                  <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                    {seg.content}
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
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-neo/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
