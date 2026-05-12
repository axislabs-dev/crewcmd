"use client";

import type { ReactNode, RefObject } from "react";
import { ChatMessage, type Attachment } from "@/components/chat/chat-message";
import {
  ExecutionProgressPanel,
  type ExecutionProgressEvent,
} from "@/components/chat/execution-progress-panel";
import type { AgentVoiceSettings } from "@/lib/tts-voices";

type ThreadDrawerMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  metadata?: { attachments?: Attachment[] } | null;
};

type ActiveThreadView = {
  parentMessage: ThreadDrawerMessage;
};

type ChatThreadDrawerProps = {
  activeThread: ActiveThreadView;
  agentCallsign: string;
  agentDisplayName: string;
  agentAvatarUrl?: string | null;
  agentEmoji?: string | null;
  userDisplayName: string;
  userAvatarUrl?: string | null;
  messages: ThreadDrawerMessage[];
  streamingContent: string;
  isLoading: boolean;
  progress: ExecutionProgressEvent | null;
  events: ExecutionProgressEvent[];
  agentColor: string;
  voiceSettings: AgentVoiceSettings | null;
  visualViewport: { height: number; offsetTop: number } | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  composer: ReactNode;
  onClose: () => void;
};

export function ChatThreadDrawer({
  activeThread,
  agentCallsign,
  agentDisplayName,
  agentAvatarUrl,
  agentEmoji,
  userDisplayName,
  userAvatarUrl,
  messages,
  streamingContent,
  isLoading,
  progress,
  events,
  agentColor,
  voiceSettings,
  visualViewport,
  scrollContainerRef,
  composer,
  onClose,
}: ChatThreadDrawerProps) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[80] flex justify-end bg-black/20 backdrop-blur-[2px] sm:bg-black/10"
      style={{
        top: visualViewport ? `${visualViewport.offsetTop}px` : 0,
        height: visualViewport ? `${visualViewport.height}px` : "100dvh",
      }}
    >
      <section className="flex h-full max-h-[100dvh] w-full flex-col border-l border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-[var(--theme-shadow-lg)] sm:max-w-[480px]">
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 pb-3 pt-[var(--mobile-safe-top)] sm:px-4 sm:pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] sm:hidden"
              aria-label="Back to chat"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Thread</div>
              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{agentCallsign}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hidden rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] sm:block"
            aria-label="Close thread"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
          <div className="space-y-4">
            <ChatMessage
              role={activeThread.parentMessage.role}
              content={activeThread.parentMessage.content}
              timestamp={activeThread.parentMessage.createdAt}
              metadata={activeThread.parentMessage.metadata}
              authorName={activeThread.parentMessage.role === "user" ? userDisplayName : agentDisplayName}
              authorAvatarUrl={activeThread.parentMessage.role === "user" ? userAvatarUrl : agentAvatarUrl}
              authorEmoji={activeThread.parentMessage.role === "assistant" ? agentEmoji : null}
              voiceSettings={voiceSettings}
            />
            <div className="ml-11 border-t border-[var(--border-subtle)] pt-4" />
            {messages.length === 0 && !streamingContent && !isLoading && (
              <div className="ml-11 py-6 text-[12px] text-[var(--text-tertiary)]">
                Reply to continue this thread.
              </div>
            )}
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.createdAt}
                metadata={message.metadata}
                authorName={message.role === "user" ? userDisplayName : agentDisplayName}
                authorAvatarUrl={message.role === "user" ? userAvatarUrl : agentAvatarUrl}
                authorEmoji={message.role === "assistant" ? agentEmoji : null}
                voiceSettings={voiceSettings}
              />
            ))}
            {(isLoading || progress) && (
              <ExecutionProgressPanel
                progress={progress}
                events={events}
                isLoading={isLoading}
                hasStreamingContent={Boolean(streamingContent)}
                agentColor={agentColor}
              />
            )}
            {streamingContent && (
              <ChatMessage
                role="assistant"
                content={streamingContent}
                isStreaming
                authorName={agentDisplayName}
                authorAvatarUrl={agentAvatarUrl}
                authorEmoji={agentEmoji}
                voiceSettings={voiceSettings}
              />
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:px-4">
          {composer}
        </div>
      </section>
    </div>
  );
}
