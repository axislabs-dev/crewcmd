"use client";

import { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ChatIdentityProfilePanel, ChatMessage, DateSeparator, getDateKey } from "@/components/chat/chat-message";
import type { Attachment, ChatIdentityDetails, ChatIdentityProfile } from "@/components/chat/chat-message";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { ChatThreadDrawer } from "@/components/chat/thread-drawer";
import { VoiceSelectModal } from "@/components/voice-select-modal";
import { WaveformVisualizer } from "@/components/chat/waveform-visualizer";
import {
  ExecutionProgressPanel,
  type ExecutionProgressEvent,
} from "@/components/chat/execution-progress-panel";
import {
  AgentTreeSelector,
  findDefaultAgent,
  findParentAgent,
} from "@/components/chat/agent-tree-selector";
import { useSessionBrowserStore } from "@/lib/session-browser-store";
import type { Agent } from "@/lib/data";
import { parseTaskReferences } from "@/lib/parse-task-references";
import { useChatStore } from "@/lib/chat-store";
import type { ChatStoreMessage } from "@/lib/chat-store";
import { useActiveChatRunStore } from "@/lib/chat-active-run-store";
import { useWorkspace } from "@/components/company-context";
import { CompanySwitcher } from "@/components/company-switcher";
import {
  playNativeVoiceAudio,
  speakNativeVoiceText,
  stopNativeVoiceAudio,
} from "@/lib/native-voice-session";
import {
  createAgentModeSessionId,
  publishAgentModeDiagnostic,
  recordVoiceCrashBreadcrumb,
} from "@/lib/agent-mode-diagnostics";
import {
  DEFAULT_AGENT_VOICE_SETTINGS,
  isExplicitServerVoice,
  normalizeAgentVoiceSettings,
  shouldUseDeviceTts,
  type AgentVoiceSettings,
} from "@/lib/tts-voices";
import { isOpenClawHeartbeatAck, isOpenClawHeartbeatArtifact } from "@/lib/openclaw-heartbeat-artifacts";

const SAVED_MESSAGES_REQUEST_CHUNK_SIZE = 25;

/** Append <!--task_card --> markers for parsed task references not already embedded. */
function injectTaskCardMarkers(content: string, refs: ReturnType<typeof parseTaskReferences>): string {
  if (refs.length === 0) return content;
  // Don't re-inject if markers already present
  if (content.includes("<!--task_card")) return content;

  const markers = refs.map((ref) => {
    const data: Record<string, unknown> = {};
    if (ref.taskId) data.id = ref.taskId;
    if (ref.shortId) data.shortId = ref.shortId;
    if (ref.title) data.title = ref.title;
    if (ref.status) data.status = ref.status;
    data.priority = "medium";
    // Only include if we have enough to render
    if (!data.id && !data.title) return "";
    return `<!--task_card ${JSON.stringify(data)} -->`;
  }).filter(Boolean);

  if (markers.length === 0) return content;
  return content + "\n\n" + markers.join("\n");
}

interface Message {
  id: string;
  threadParentId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  metadata?: { attachments?: Attachment[] } | null;
}

type ThreadParentLink = {
  parentSessionKey: string;
  parentMessageId?: string | null;
};

type ActiveThread = {
  sessionKey: string;
  parentSessionKey: string;
  parentMessage: Message;
  contextMessages: Message[];
};

type ThreadReplySummary = {
  sessionKey: string;
  replies: Array<{ id: string; role: "user" | "assistant"; createdAt?: string }>;
};

type ThreadHistoryLoadResult = {
  links: Record<string, ThreadParentLink>;
  summaries: Record<string, ThreadReplySummary>;
};

type ThreadHistoryResponse = {
  threads?: Array<{
    sessionKey?: string | null;
    parentSessionKey?: string | null;
    parentMessageId?: string | null;
    messages?: Array<{
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
      metadata?: Record<string, unknown> | null;
    }>;
  }>;
  threadSummaries?: Record<string, {
    sessionKey?: string | null;
    replies?: Array<{ id: string; role: "user" | "assistant" | "system"; createdAt?: string }>;
  }>;
  threadIndex?: Record<string, {
    sessionKey?: string | null;
    replies?: Array<{ id: string; role: "user" | "assistant" | "system"; createdAt?: string }>;
  }>;
};

type ChatExecutionSnapshot = {
  progress?: ExecutionProgressEvent | null;
  events?: ExecutionProgressEvent[];
} | null;

type ChatHistoryLoadResult = {
  sessionId: string | null;
  execution: ChatExecutionSnapshot;
  threadHistory: ThreadHistoryLoadResult;
} | null;

type ChatPin = {
  id: string;
  messageId: string;
  createdAt: string;
  role: "user" | "assistant";
  content: string;
  messageCreatedAt?: string;
  agentId?: string;
  gatewaySessionKey?: string | null;
};

type SavedItem = {
  id: string;
  sourceId: string;
};

type ChatChannelMember = {
  id?: string;
  memberType: "user" | "agent";
  userId?: string | null;
  agentId?: string | null;
  role: string;
  agentParticipationMode?: "silent" | "watching" | "mention_only" | "proactive" | "on_call" | null;
  name?: string | null;
  email?: string | null;
};

type ChatChannel = {
  id: string;
  name: string | null;
  description?: string | null;
  visibility: "private" | "restricted" | "team" | "org";
  myRole?: string | null;
  canManage?: boolean;
  members?: ChatChannelMember[];
};

type QueuedChatMessage = {
  id: string;
  text: string;
  files: File[];
  options: { forceVoiceResponse?: boolean };
};

type QueuedThreadMessage = {
  id: string;
  thread: ActiveThread;
  text: string;
  files: File[];
};

function hasRenderableMessageContent(message: Pick<Message, "content" | "metadata">) {
  return Boolean(message.content.trim() || message.metadata?.attachments?.length);
}

function isThreadContextEnvelope(content: string) {
  return /^\s*(?:user:\s*)?CrewCMD threaded reply\./i.test(content);
}

function extractUserThreadReply(content: string) {
  const match = content.match(/\nUser thread reply:\n([\s\S]*)$/i);
  return match?.[1]?.trim() || "";
}

function displayContentFromGatewayPreview(content: string, sessionKey: string) {
  if (!isThreadContextEnvelope(content)) return content;
  return isMessageThreadSessionKey(sessionKey) ? extractUserThreadReply(content) : "";
}

function isVisibleChatMessage(message: Pick<Message, "role" | "content" | "metadata">) {
  return (
    hasRenderableMessageContent(message) &&
    !isThreadContextEnvelope(message.content) &&
    !isOpenClawHeartbeatArtifact({ role: message.role, content: message.content })
  );
}

function isHeartbeatAckMessage(message: { role?: string | null; content?: string | null }) {
  return isOpenClawHeartbeatAck({ role: message.role, content: message.content });
}

function HeartbeatAckMarker({ timestamp }: { timestamp?: string | null }) {
  const label = timestamp ? new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="flex justify-center py-1">
      <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-3 py-1 text-[11px] text-[var(--text-tertiary)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]/70" aria-hidden="true" />
        <span>Heartbeat checked</span>
        {label && <span className="text-[var(--text-tertiary)]/70">{label}</span>}
      </div>
    </div>
  );
}

function stableHash(input: string) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function stablePreviewMessageId(params: {
  sessionKey: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string | null;
}) {
  const normalizedContent = params.content.trim().replace(/\s+/g, " ");
  const basis = [
    params.sessionKey.toLowerCase(),
    params.role,
    params.createdAt ?? "",
    normalizedContent,
  ].join("\n");
  return `${params.sessionKey.toLowerCase()}:preview:${stableHash(basis)}`;
}

function uniquePreviewMessageId(stableId: string, index: number) {
  return `${stableId}:item:${index}`;
}

function stableThreadLinkId(id: string) {
  return id.replace(/(?::item:|-item-)\d+$/i, "");
}

function executionStorageKey(sessionKey: string) {
  return `${CHAT_EXECUTION_STORAGE_PREFIX}${sessionKey.toLowerCase()}`;
}

function threadSessionKey(parentSessionKey: string, parentMessageId: string) {
  const safeId = stableThreadLinkId(parentMessageId).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${parentSessionKey}:thread:${safeId || "message"}`;
}

function threadParentIdForMessage(message: Pick<Message, "id" | "threadParentId">) {
  return stableThreadLinkId(message.threadParentId ?? message.id);
}

function threadSessionSuffix(parentSessionKey: string, sessionKey: string) {
  const prefix = `${parentSessionKey.toLowerCase()}:thread:`;
  const lower = sessionKey.toLowerCase();
  return lower.startsWith(prefix) ? lower.slice(prefix.length) : null;
}

type VoiceMode = "off" | "agent";
type AgentOverlayMode = "transcript" | "immersive";

const CHAT_AGENT_STORAGE_KEY = "crewcmd.chat.selected-agent";
const CHAT_SESSION_STORAGE_KEY = "crewcmd.chat.selected-session";
const CHAT_EXECUTION_STORAGE_PREFIX = "crewcmd.chat.execution.";
const VOICE_ACK_DELAY_MS = 5000;
const VOICE_CHECKIN_DELAY_MS = 30000;
const VOICE_FAST_START_MIN_CHARS = 48;
const VOICE_FAST_START_MAX_CHARS = 110;

function useFileObjectUrl(file: File) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

const PendingFilePreview = memo(function PendingFilePreview({
  file,
  index,
  onRemove,
}: {
  file: File;
  index: number;
  onRemove: (index: number) => void;
}) {
  const imageUrl = useFileObjectUrl(file);

  return (
    <div className="group relative">
      {file.type.startsWith("image/") ? (
        <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-[var(--border-medium)]">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URLs for local previews should not route through Next Image.
            <img
              src={imageUrl}
              alt={file.name}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <span className="max-w-[100px] truncate">{file.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-primary)] border border-[var(--border-medium)] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--text-primary)]"
        aria-label={`Remove ${file.name}`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

function VoicePersonIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20.25a7.5 7.5 0 0 1 15 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5c1 .8 1.5 1.9 1.5 3s-.5 2.2-1.5 3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 5.25c1.5 1.35 2.25 3.15 2.25 5.25s-.75 3.9-2.25 5.25" />
    </svg>
  );
}

function ChatComposer({
  value,
  onValueChange,
  placeholder,
  pendingFiles,
  onAddFiles,
  onRemoveFile,
  onSend,
  onTranscript,
  onFocus,
  isLoading,
  speakResponses,
  onToggleSpeak,
  onEnterAgentMode,
  showAgentMode = true,
  agentButtonTitle = "Enter agent mode (hands-free)",
  addMenuLabel = "Add to Chat",
  isDragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  pendingFiles: File[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (index: number) => void;
  onSend: (value: string) => void;
  onTranscript: (value: string) => void;
  onFocus?: () => void;
  isLoading: boolean;
  speakResponses: boolean;
  onToggleSpeak: () => void;
  onEnterAgentMode: () => void;
  showAgentMode?: boolean;
  agentButtonTitle?: string;
  addMenuLabel?: string;
  isDragOver?: boolean;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const sendDraft = useCallback(() => {
    onValueChange(draft);
    onSend(draft);
    setDraft("");
  }, [draft, onSend, onValueChange]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.csv"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onAddFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onAddFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        className={`relative rounded-[var(--radius-panel)] border bg-[var(--bg-surface)] transition-colors focus-within:border-[var(--control-border-focus)] focus-within:bg-[var(--bg-surface-hover)] ${
          isDragOver
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border-medium)]"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {pendingFiles.map((file, index) => (
              <PendingFilePreview
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                file={file}
                index={index}
                onRemove={onRemoveFile}
              />
            ))}
          </div>
        )}

        {isDragOver && (
          <div className="flex items-center justify-center px-4 py-3">
            <span className="text-[12px] text-[var(--accent)]">Drop files to attach</span>
          </div>
        )}

        <textarea
          value={draft}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          inputMode="text"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setShowAddMenu(false);
          }}
          onFocus={onFocus}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendDraft();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (files.length) {
              event.preventDefault();
              onAddFiles(files);
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pb-1 pt-3 text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] sm:text-[14px]"
          style={{ maxHeight: "140px" }}
          onInput={(event) => {
            const target = event.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
          }}
        />

        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              title={addMenuLabel}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                showAddMenu
                  ? "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            <button
              onClick={onToggleSpeak}
              title={speakResponses ? "Mute responses" : "Speak responses"}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                speakResponses
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {speakResponses ? (
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              ) : (
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              )}
            </button>

          </div>

          <div className="flex items-center gap-1">
            <VoiceRecorder
              onTranscript={onTranscript}
              isDisabled={isLoading}
            />
            {draft.trim() || pendingFiles.length > 0 ? (
              <button
                onClick={sendDraft}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--bg-primary)] transition-all hover:opacity-90"
                title="Send message"
                style={{ boxShadow: "0 0 12px color-mix(in srgb, var(--accent) 30%, transparent)" }}
              >
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            ) : showAgentMode ? (
              <button
                onClick={onEnterAgentMode}
                title={agentButtonTitle}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-all hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {showAddMenu && (
          <div className="absolute bottom-full left-2 z-20 mb-2 w-64 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] shadow-xl backdrop-blur-xl animate-fade-in">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">{addMenuLabel}</span>
              <button
                onClick={() => setShowAddMenu(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-all hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2 px-4 pb-3">
              <button
                onClick={() => { cameraInputRef.current?.click(); setShowAddMenu(false); }}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                </svg>
                <span className="text-[11px] font-medium">Camera</span>
              </button>
              <button
                onClick={() => { fileInputRef.current?.setAttribute("accept", "image/*"); fileInputRef.current?.click(); setShowAddMenu(false); setTimeout(() => fileInputRef.current?.setAttribute("accept", "image/*,.pdf,.txt,.md,.csv"), 100); }}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z" />
                </svg>
                <span className="text-[11px] font-medium">Image</span>
              </button>
              <button
                onClick={() => { fileInputRef.current?.click(); setShowAddMenu(false); }}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <span className="text-[11px] font-medium">File</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
type CapacitorPushToken = { value: string };
type CapacitorNotificationAction = { notification?: { data?: Record<string, unknown> } };
type CapacitorPluginHandle = { remove: () => Promise<void> };
type CapacitorPushPlugin = {
  addListener: (
    eventName: "registration" | "registrationError" | "pushNotificationActionPerformed",
    listener: (payload: never) => void
  ) => Promise<CapacitorPluginHandle>;
  checkPermissions: () => Promise<{ receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  requestPermissions: () => Promise<{ receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  register: () => Promise<void>;
};
type NativeCapacitor = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: { PushNotifications?: CapacitorPushPlugin };
};

let mobilePushRegistrationStarted = false;

function getNativeCapacitor() {
  if (typeof window === "undefined") return null;
  return (window as Window & { Capacitor?: NativeCapacitor }).Capacitor ?? null;
}

function isNativeCapacitorApp() {
  const capacitor = getNativeCapacitor();
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android";
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio blob"));
    reader.readAsDataURL(blob);
  });
}

function createClientId() {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getMobileDeviceId() {
  const key = "crewcmd.mobile.device-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = createClientId();
  window.localStorage.setItem(key, next);
  return next;
}

async function registerMobilePushDevice(companyId: string) {
  const capacitor = getNativeCapacitor();
  if (!capacitor) return;
  if (!isNativeCapacitorApp()) return;
  const push = capacitor.Plugins?.PushNotifications;
  if (!push || mobilePushRegistrationStarted) return;
  mobilePushRegistrationStarted = true;

  const platform = capacitor.getPlatform?.() ?? "web";
  if (platform !== "ios" && platform !== "android") return;
  const provider = platform === "ios" ? "apns" : "fcm";

  await push.addListener("registration", ((token: CapacitorPushToken) => {
    fetch("/api/mobile/push-devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        platform,
        provider,
        token: token.value,
        deviceId: getMobileDeviceId(),
        appId: "crewcmd-mobile",
      }),
    }).catch((error) => console.error("[chat] Mobile push registration upload failed:", error));
  }) as (payload: never) => void);

  await push.addListener("registrationError", ((error: unknown) => {
    console.error("[chat] Mobile push registration failed:", error);
  }) as (payload: never) => void);

  await push.addListener("pushNotificationActionPerformed", ((action: CapacitorNotificationAction) => {
    const url = action.notification?.data?.url;
    if (typeof url === "string" && url.startsWith("/")) {
      window.location.assign(url);
    }
  }) as (payload: never) => void);

  let permission = await push.checkPermissions();
  if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
    permission = await push.requestPermissions();
  }
  if (permission.receive === "granted") {
    await push.register();
  }
}

function updateChatRunVisibility(runId: string | null, visibility: "visible" | "hidden" | "disconnected") {
  if (!runId) return;
  const body = JSON.stringify({ visibility });
  const url = `/api/chat/runs/${encodeURIComponent(runId)}/visibility`;
  fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: visibility !== "visible",
  }).catch(() => {
    // Best effort only; missed visibility pings should not affect chat.
  });
}

const VOICE_SYSTEM_PROMPT = [
  "VOICE MODE. Responses are spoken aloud via TTS. The user cannot see text.",
  "",
  "LENGTH: One to two sentences. Maximum 40 words. This is a hard limit. Think walkie-talkie, not essay.",
  "",
  "BANNED: emojis, unicode, dashes, bullets, numbered lists, bold, italic, headers, code blocks, asterisks, backticks, URLs, file paths, code. Any of these is a critical failure.",
  "",
  "STYLE: Plain spoken English. Short. Direct. Spell out numbers. If details needed, say you will send them in text.",
].join("\n");

function extractCompleteSentences(buffer: string) {
  const sentences: string[] = [];
  let remaining = buffer;
  const sentenceBoundary = /^([\s\S]*?[.!?])(?:\s+|$)([\s\S]*)/;

  while (true) {
    const match = remaining.match(sentenceBoundary);
    if (!match) break;
    const sentence = match[1].trim();
    if (sentence) sentences.push(sentence);
    remaining = match[2];
    if (!remaining.trim()) break;
  }

  return { sentences, remaining };
}

function extractSpeakableSegments(buffer: string) {
  const extracted = extractCompleteSentences(buffer);
  if (extracted.sentences.length > 0 || extracted.remaining.length < VOICE_FAST_START_MIN_CHARS) {
    return extracted;
  }

  const softBoundary = Math.max(
    extracted.remaining.lastIndexOf(","),
    extracted.remaining.lastIndexOf(";"),
    extracted.remaining.lastIndexOf(":"),
    extracted.remaining.lastIndexOf("\n")
  );

  if (softBoundary >= VOICE_FAST_START_MIN_CHARS) {
    return {
      sentences: [extracted.remaining.slice(0, softBoundary + 1).trim()],
      remaining: extracted.remaining.slice(softBoundary + 1).trimStart(),
    };
  }

  if (extracted.remaining.length < VOICE_FAST_START_MAX_CHARS) {
    return extracted;
  }

  const hardBoundary = extracted.remaining.lastIndexOf(" ", VOICE_FAST_START_MAX_CHARS);
  if (hardBoundary < VOICE_FAST_START_MIN_CHARS) {
    return extracted;
  }

  return {
    sentences: [extracted.remaining.slice(0, hardBoundary).trim()],
    remaining: extracted.remaining.slice(hardBoundary + 1).trimStart(),
  };
}

function selectedSessionBelongsToAgent(
  sessionKey: string | null,
  callsign: string | null | undefined
) {
  if (!sessionKey || !callsign) return false;
  const key = sessionKey.toLowerCase();
  const agent = callsign.toLowerCase();
  return key === agent || key.startsWith(`${agent}:`);
}

function chatMessageFromStore(message: ChatStoreMessage): Message {
  const threadParentId = typeof message.metadata?.threadParentId === "string"
    ? message.metadata.threadParentId
    : undefined;
  return {
    id: message.id,
    threadParentId,
    role: message.role as "user" | "assistant",
    content: message.content,
    createdAt: message.createdAt,
    metadata: message.metadata,
  };
}

function uniqueMessagesById(messages: Message[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function messagePreview(content: string, max = 140) {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function gatewaySessionKeyForAgent(agent: Agent | null | undefined) {
  const runtimeRef = agent?.runtimeRef?.trim().toLowerCase();
  if (runtimeRef === "main") return "main";
  return agent?.callsign.toLowerCase() ?? "main";
}

function agentDisplayCallsign(agent: Agent | null | undefined) {
  return agent?.callsign ?? "MAIN";
}

function sameAgent(a: Agent | null | undefined, b: Agent | null | undefined) {
  if (!a || !b) return false;
  return a.id === b.id || a.callsign.toLowerCase() === b.callsign.toLowerCase();
}

function isMessageThreadSessionKey(sessionKey: string | null | undefined) {
  return Boolean(sessionKey?.toLowerCase().includes(":thread:"));
}

function normalizeThreadHistoryResponse(response: ThreadHistoryResponse): ThreadHistoryLoadResult {
  const links: Record<string, ThreadParentLink> = {};
  for (const thread of response.threads ?? []) {
    if (!thread.sessionKey || !thread.messages?.length) continue;
    const threadSessionKey = thread.sessionKey.toLowerCase();
    if (thread.parentSessionKey && thread.parentMessageId) {
      links[threadSessionKey] = {
        parentSessionKey: thread.parentSessionKey,
        parentMessageId: stableThreadLinkId(thread.parentMessageId),
      };
    }
    useChatStore.getState().loadSession(
      threadSessionKey,
      thread.messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({
        id: m.id,
        agentId: threadSessionKey,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata ?? null,
      }))
    );
  }

  const summaryEntries = Object.keys(response.threadIndex ?? {}).length > 0
    ? Object.entries(response.threadIndex ?? {})
    : Object.entries(response.threadSummaries ?? {}).map(([parentMessageId, summary]) => [`id:${stableThreadLinkId(parentMessageId)}`, summary] as const);
  const summaries = Object.fromEntries(
    summaryEntries.flatMap(([parentMessageKey, summary]) => {
      if (!summary.sessionKey) return [];
      const replies = (summary.replies ?? [])
        .filter((reply) => reply.role === "user" || reply.role === "assistant")
        .map((reply) => ({
          id: reply.id,
          role: reply.role as "user" | "assistant",
          createdAt: reply.createdAt,
        }));
      if (replies.length === 0) return [];
      return [[parentMessageKey, {
        sessionKey: summary.sessionKey.toLowerCase(),
        replies,
      }]];
    })
  );
  return { links, summaries };
}

async function loadCrewCmdSessionHistoryByKey(
  sessionKey: string,
  companyId?: string | null,
  workspaceId?: string | null,
): Promise<ChatHistoryLoadResult> {
  if (!companyId && !workspaceId) return null;
  try {
    const params = new URLSearchParams({ sessionKey, limit: "200" });
    if (companyId) params.set("companyId", companyId);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const res = await fetch(`/api/chat/messages?${params.toString()}`);
    if (!res.ok) return null;
    const history = await res.json() as ThreadHistoryResponse & {
      sessionId: string | null;
      execution?: ChatExecutionSnapshot;
      messages: {
        id: string;
        role: "user" | "assistant" | "system";
        content: string;
        createdAt: string;
        metadata?: Record<string, unknown> | null;
      }[];
    };
    const { messages, sessionId, execution } = history;
    if (!sessionId) return null;
    useChatStore.getState().loadSession(
      sessionKey.toLowerCase(),
      messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({
        id: m.id,
        agentId: sessionKey.toLowerCase(),
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata ?? null,
      }))
    );
    return { sessionId, execution: execution ?? null, threadHistory: normalizeThreadHistoryResponse(history) };
  } catch {
    return null;
  }
}

async function loadThreadHistoriesForParent(
  parentSessionKey: string,
  companyId?: string | null,
  workspaceId?: string | null,
): Promise<ThreadHistoryLoadResult> {
  if (!companyId && !workspaceId) return { links: {}, summaries: {} };
  try {
    const params = new URLSearchParams({
      threadParentSessionKey: parentSessionKey,
      limit: "200",
    });
    if (companyId) params.set("companyId", companyId);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const res = await fetch(`/api/chat/messages?${params.toString()}`);
    if (!res.ok) return { links: {}, summaries: {} };
    return normalizeThreadHistoryResponse(await res.json() as ThreadHistoryResponse);
  } catch {
    // Thread reply summaries are best-effort; opening a thread still loads it directly.
    return { links: {}, summaries: {} };
  }
}

/** Load message preview from the gateway session API (for session browser) */
async function loadSessionPreviewIntoStore(sessionKey: string) {
  try {
    const res = await fetch(
      `/api/openclaw/sessions/${encodeURIComponent(sessionKey)}/preview`
    );
    if (!res.ok) return false;

    const data = await res.json() as {
      status?: "ok" | "empty" | "missing" | "error";
      items?: Array<{ id?: string; role?: string; text?: string; content?: string; createdAt?: string }>;
      preview?: {
        items?: Array<{ id?: string; role?: string; text?: string; content?: string; createdAt?: string }>;
        messages?: Array<{ id?: string; role?: string; text?: string; content?: string; createdAt?: string }>;
      } | Array<{ id?: string; role?: string; text?: string; content?: string; createdAt?: string }> | null;
    };

    const previewItems = Array.isArray(data.preview)
      ? data.preview
      : data.preview?.items ?? data.preview?.messages;
    const items = data.items ?? previewItems ?? [];
    if (data.status && data.status !== "ok") return false;
    if (!items.length) return false;

    const messages = items.map((m, index): ChatStoreMessage => {
      const rawContent = m.text ?? m.content ?? "";
      const role = m.role === "user" ? "user" : "assistant";
      const content = displayContentFromGatewayPreview(rawContent, sessionKey);
      const createdAt = m.createdAt ?? new Date().toISOString();
      const stableId = stableThreadLinkId(m.id ?? stablePreviewMessageId({ sessionKey, role, content, createdAt: m.createdAt ?? null }));
      const messageId = m.id ?? uniquePreviewMessageId(stableId, index);
      return {
        id: messageId,
        agentId: sessionKey.toLowerCase(),
        role,
        content,
        createdAt,
        metadata: stableId === messageId ? null : { threadParentId: stableId },
      };
    }).filter((m) =>
      m.content &&
      (!isOpenClawHeartbeatArtifact({ role: m.role, content: m.content }) || isHeartbeatAckMessage(m))
    );

    useChatStore.getState().loadSession(
      sessionKey.toLowerCase(),
      messages
    );
    return messages.length > 0;
  } catch {
    // Gateway unavailable
    return false;
  }
}

export default function ChatPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { workspace, company } = useWorkspace();
  const chatCompanyId = company?.id ?? null;
  const chatWorkspaceId = workspace?.id ?? null;
  const chatScopeKey = chatCompanyId ?? chatWorkspaceId ?? "preview";
  const storeMarkRead = useChatStore((s) => s.markRead);
  const storeClearAgent = useChatStore((s) => s.clearAgent);
  const {
    selectedSessionKey,
    selectSession,
  } = useSessionBrowserStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgressEvent | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionProgressEvent[]>([]);
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [threadStreamingContent, setThreadStreamingContent] = useState("");
  const [threadProgress, setThreadProgress] = useState<ExecutionProgressEvent | null>(null);
  const [threadEvents, setThreadEvents] = useState<ExecutionProgressEvent[]>([]);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [agentModeSessionKey, setAgentModeSessionKey] = useState<string | null>(null);
  const [agentOverlayMode, setAgentOverlayMode] = useState<AgentOverlayMode>("transcript");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [speakResponses, setSpeakResponses] = useState(false);
  const [agentMicMuted, setAgentMicMuted] = useState(false);
  const [agentAudioMuted, setAgentAudioMuted] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [sessionVoiceOverride, setSessionVoiceOverride] = useState<AgentVoiceSettings | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const unreadCounts = useChatStore((s) => s.unreadByAgent);
  const messagesByStoreKey = useChatStore((s) => s.messagesByAgent);
  const [isPaused, setIsPaused] = useState(false);
  const [stopWords, setStopWords] = useState<string[]>([
    "stop", "pause", "shut up", "be quiet", "hold on", "wait", "enough", "stop talking",
  ]);

  const [showScrollButton, setShowScrollButton] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [threadPendingFiles, setThreadPendingFiles] = useState<File[]>([]);
  const [preferredAgentCallsign, setPreferredAgentCallsign] = useState<string | null>(null);
  const [preferredSessionKey, setPreferredSessionKey] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [visualViewport, setVisualViewport] = useState<{ height: number; offsetTop: number } | null>(null);
  const [threadParentLinks, setThreadParentLinks] = useState<Record<string, ThreadParentLink>>({});
  const [serverThreadSummaries, setServerThreadSummaries] = useState<Record<string, ThreadReplySummary>>({});
  const [pins, setPins] = useState<ChatPin[]>([]);
  const [savedByMessageId, setSavedByMessageId] = useState<Record<string, SavedItem>>({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [urlAgentCallsign, setUrlAgentCallsign] = useState<string | null>(null);
  const [urlSessionKey, setUrlSessionKey] = useState<string | null>(null);
  const [urlMessageId, setUrlMessageId] = useState<string | null>(null);
  const [activeIdentityProfile, setActiveIdentityProfile] = useState<ChatIdentityProfile | null>(null);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelPurpose, setNewChannelPurpose] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [channelNotice, setChannelNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingMessageScrollRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const threadScrollContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const ttsSessionRef = useRef<string>(createAgentModeSessionId("tts"));
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingStartRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatRunIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const isThreadLoadingRef = useRef(false);
  const savedMessageIdsSignatureRef = useRef<string | null>(null);
  const queuedMainMessagesRef = useRef<QueuedChatMessage[]>([]);
  const queuedThreadMessagesRef = useRef<QueuedThreadMessage[]>([]);
  const activeAudioKindRef = useRef<"filler" | "response" | null>(null);
  const fillerAudioTokenRef = useRef(0);
  const firstDeltaSeenRef = useRef(false);
  const lastBusyReplyAtRef = useRef(0);
  const hasStartedResponseAudioRef = useRef(false);
  const pageHiddenDuringRequestRef = useRef(false);
  const voiceLatencyRef = useRef<{
    requestId: string;
    startedAt: number;
    firstDeltaAt?: number;
    firstSentenceQueuedAt?: number;
    firstAudioStartedAt?: number;
  } | null>(null);

  // Track in-flight streaming so we can persist on unmount (navigation away)
  const streamingContentRef = useRef("");
  const streamingAgentRef = useRef<string | null>(null);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    isThreadLoadingRef.current = isThreadLoading;
  }, [isThreadLoading]);

  // Sentence-level TTS queue for agent mode
  const ttsQueueRef = useRef<string[]>([]);
  const isSpeakingQueueRef = useRef(false);
  const spokenSentencesRef = useRef<number>(0);
  const prefetchedAudioRef = useRef<{ text: string; url: string } | null>(null);

  const revokeAudioObjectUrl = useCallback((url: string | null, reason: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    if (audioObjectUrlRef.current === url) {
      audioObjectUrlRef.current = null;
    }
    publishAgentModeDiagnostic({
      scope: "chat-tts",
      event: "object-url.revoke",
      sessionId: ttsSessionRef.current,
      detail: { reason },
    });
  }, []);

  const revokePrefetchedAudio = useCallback((reason: string) => {
    if (!prefetchedAudioRef.current) return;
    revokeAudioObjectUrl(prefetchedAudioRef.current.url, reason);
    prefetchedAudioRef.current = null;
  }, [revokeAudioObjectUrl]);

  const assignAudioObjectUrl = useCallback((url: string, reason: string) => {
    if (audioObjectUrlRef.current && audioObjectUrlRef.current !== url) {
      revokeAudioObjectUrl(audioObjectUrlRef.current, "replace-active-audio");
    }
    audioObjectUrlRef.current = url;
    publishAgentModeDiagnostic({
      scope: "chat-tts",
      event: "object-url.assign",
      sessionId: ttsSessionRef.current,
      detail: { reason },
    });
  }, [revokeAudioObjectUrl]);

  // Derive session key: if a gateway session is selected, use it;
  // otherwise use the runtime gateway key. A runtimeRef="main" agent may have
  // any display callsign, but its durable chat session is still "main".
  const activeSessionKey = useMemo(
    () => selectedSessionKey ?? gatewaySessionKeyForAgent(selectedAgent),
    [selectedSessionKey, selectedAgent]
  );
  const agentDefaultVoice = useMemo(
    () => normalizeAgentVoiceSettings(selectedAgent?.runtimeConfig?.voice ?? DEFAULT_AGENT_VOICE_SETTINGS),
    [selectedAgent?.runtimeConfig]
  );
  const resolvedVoiceSettings = useMemo(
    () => normalizeAgentVoiceSettings(sessionVoiceOverride ?? agentDefaultVoice),
    [agentDefaultVoice, sessionVoiceOverride]
  );

  useEffect(() => {
    setSessionVoiceOverride(null);
  }, [activeSessionKey]);

  const scopedSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    if (chatCompanyId) params.set("companyId", chatCompanyId);
    if (chatWorkspaceId) params.set("workspaceId", chatWorkspaceId);
    if (activeChannelId) params.set("channelId", activeChannelId);
    return params;
  }, [activeChannelId, chatCompanyId, chatWorkspaceId]);

  const loadChannels = useCallback(async () => {
    if (!chatCompanyId && !chatWorkspaceId) {
      setChannels([]);
      setActiveChannelId(null);
      return;
    }
    const params = new URLSearchParams();
    if (chatCompanyId) params.set("companyId", chatCompanyId);
    if (chatWorkspaceId) params.set("workspaceId", chatWorkspaceId);
    try {
      const res = await fetch(`/api/channels?${params.toString()}`);
      if (!res.ok) {
        setChannelNotice("Channels are unavailable for this scope.");
        return;
      }
      const data = await res.json() as { channels?: ChatChannel[] };
      const nextChannels = data.channels ?? [];
      setChannels(nextChannels);
      setActiveChannelId((current) => {
        if (current && nextChannels.some((channel) => channel.id === current)) return current;
        return nextChannels[0]?.id ?? null;
      });
      setChannelNotice(null);
    } catch {
      setChannelNotice("Could not load channels.");
    }
  }, [chatCompanyId, chatWorkspaceId]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const createChannel = useCallback(async () => {
    const name = newChannelName.trim();
    if (!name || (!chatCompanyId && !chatWorkspaceId)) return;
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: chatCompanyId,
          workspaceId: chatWorkspaceId,
          name,
          purpose: newChannelPurpose.trim() || null,
        }),
      });
      const data = await res.json() as { channel?: ChatChannel; error?: string };
      if (!res.ok || !data.channel) {
        setChannelNotice(data.error ?? "Could not create channel.");
        return;
      }
      setChannels((prev) => [data.channel!, ...prev]);
      setActiveChannelId(data.channel.id);
      selectSession(null);
      setMessages([]);
      setNewChannelName("");
      setNewChannelPurpose("");
      setChannelNotice(null);
    } catch {
      setChannelNotice("Could not create channel.");
    }
  }, [chatCompanyId, chatWorkspaceId, newChannelName, newChannelPurpose, selectSession]);

  const addChannelMember = useCallback(async () => {
    if (!activeChannelId || !memberUserId.trim()) return;
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(activeChannelId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId.trim(), role: "member" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setChannelNotice(data.error ?? "Could not add member.");
        return;
      }
      setMemberUserId("");
      await loadChannels();
    } catch {
      setChannelNotice("Could not add member.");
    }
  }, [activeChannelId, loadChannels, memberUserId]);

  const selectChannel = useCallback((channelId: string | null) => {
    setActiveChannelId(channelId);
    selectSession(null);
    setMessages([]);
    setPins([]);
    setActiveThread(null);
    setThreadMessages([]);
  }, [selectSession]);

  const loadPins = useCallback(async () => {
    if (!chatCompanyId && !chatWorkspaceId) {
      setPins([]);
      return;
    }
    const params = scopedSearchParams();
    params.set("sessionKey", activeSessionKey);
    try {
      const res = await fetch(`/api/chat/pins?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { pins?: ChatPin[] };
      setPins(data.pins ?? []);
    } catch {
      // Pin loading is non-blocking; chat history remains usable without it.
    }
  }, [activeSessionKey, chatCompanyId, chatWorkspaceId, scopedSearchParams]);

  const loadSavedMessages = useCallback(async (messageIds: string[]) => {
    if ((!chatCompanyId && !chatWorkspaceId) || messageIds.length === 0) {
      setSavedByMessageId({});
      return;
    }
    const params = scopedSearchParams();
    params.set("sourceType", "chat_message");
    try {
      const chunks: string[][] = [];
      for (let index = 0; index < messageIds.length; index += SAVED_MESSAGES_REQUEST_CHUNK_SIZE) {
        chunks.push(messageIds.slice(index, index + SAVED_MESSAGES_REQUEST_CHUNK_SIZE));
      }

      const results = await Promise.all(chunks.map(async (chunk) => {
        const chunkParams = new URLSearchParams(params);
        chunkParams.set("sourceIds", chunk.join(","));
        const res = await fetch(`/api/saved-items?${chunkParams.toString()}`);
        if (!res.ok) return [];
        const data = await res.json() as { items?: SavedItem[] };
        return data.items ?? [];
      }));

      setSavedByMessageId(Object.fromEntries(results.flat().map((item) => [item.sourceId, item])));
    } catch {
      // Saved state is best-effort and can refresh on the next message load.
    }
  }, [chatCompanyId, chatWorkspaceId, scopedSearchParams]);

  const scrollThreadToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadScrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const setMainLoading = useCallback((next: boolean) => {
    isLoadingRef.current = next;
    setIsLoading(next);
  }, []);

  const setThreadLoading = useCallback((next: boolean) => {
    isThreadLoadingRef.current = next;
    setIsThreadLoading(next);
  }, []);

  const enqueueMainMessage = useCallback((text: string, files: File[], options: { forceVoiceResponse?: boolean }) => {
    const id = `queued-${createClientId()}`;
    queuedMainMessagesRef.current.push({ id, text, files, options });
    setMessages((prev) => [
      ...prev,
      {
        id,
        role: "user",
        content: text.trim() || "(attachments)",
        createdAt: new Date().toISOString(),
        metadata: files.length > 0 ? { attachments: [] } : null,
      },
    ]);
    wasAtBottomRef.current = true;
    setInput("");
    setPendingFiles([]);
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  const enqueueThreadMessage = useCallback((thread: ActiveThread, text: string, files: File[]) => {
    const id = `queued-${createClientId()}`;
    queuedThreadMessagesRef.current.push({ id, thread, text, files });
    setThreadMessages((prev) => [
      ...prev,
      {
        id,
        role: "user",
        content: text.trim() || "(attachments)",
        createdAt: new Date().toISOString(),
        metadata: files.length > 0 ? { attachments: [] } : null,
      },
    ]);
    setThreadInput("");
    setThreadPendingFiles([]);
    requestAnimationFrame(() => scrollThreadToBottom("smooth"));
  }, [scrollThreadToBottom]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeThread) return;
    const viewport = window.visualViewport;
    if (!viewport) {
      setVisualViewport(null);
      return;
    }

    const updateViewport = () => {
      setVisualViewport({
        height: viewport.height,
        offsetTop: viewport.offsetTop,
      });
      window.requestAnimationFrame(() => scrollThreadToBottom());
    };

    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    };
  }, [activeThread, scrollThreadToBottom]);
  const ttsBreadcrumbContextRef = useRef({
    mode: voiceMode,
    agent: selectedAgent?.callsign ?? null,
    sessionKey: activeSessionKey,
    isPlayingAudio,
    isLoading,
  });

  useEffect(() => {
    ttsBreadcrumbContextRef.current = {
      mode: voiceMode,
      agent: selectedAgent?.callsign ?? null,
      sessionKey: activeSessionKey,
      isPlayingAudio,
      isLoading,
    };
  }, [activeSessionKey, isLoading, isPlayingAudio, selectedAgent?.callsign, voiceMode]);

  const recordTtsBreadcrumb = useCallback((
    event: string,
    detail?: Record<string, unknown>,
  ) => {
    if (!isNativeCapacitorApp()) return;
    recordVoiceCrashBreadcrumb({
      scope: "chat-tts",
      event,
      sessionId: ttsSessionRef.current,
      detail: {
        ...ttsBreadcrumbContextRef.current,
        ttsMode: ttsModRef.current,
        activeAudioKind: activeAudioKindRef.current,
        queueDepth: ttsQueueRef.current.length,
        ...detail,
      },
    });
  }, []);
  const applyExecutionSnapshot = useCallback((snapshot: ChatExecutionSnapshot) => {
    const progress = snapshot?.progress ?? null;
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    setExecutionProgress(progress);
    setExecutionEvents(events);
    if (progress) {
      const progressRecord = progress as ExecutionProgressEvent & { sessionKey?: string };
      useActiveChatRunStore.getState().applyProgressEvent({
        type: "chat_progress",
        ...progressRecord,
        sessionKey: progressRecord.sessionKey ?? activeSessionKey,
      });
    }
  }, [activeSessionKey]);
  const persistExecutionSnapshot = useCallback((
    progress: ExecutionProgressEvent | null,
    events: ExecutionProgressEvent[]
  ) => {
    if (typeof window === "undefined") return;

    try {
      const key = executionStorageKey(activeSessionKey);
      if (!progress && events.length === 0) {
        window.sessionStorage.removeItem(key);
        return;
      }
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          progress,
          events: events.slice(-40),
        })
      );
    } catch {
      // Session storage is a best-effort UI cache.
    }
  }, [activeSessionKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(executionStorageKey(activeSessionKey));
      if (!raw) {
        setExecutionProgress(null);
        setExecutionEvents([]);
        return;
      }
      const snapshot = JSON.parse(raw) as {
        progress?: ExecutionProgressEvent | null;
        events?: ExecutionProgressEvent[];
      };
      setExecutionProgress(snapshot.progress ?? null);
      setExecutionEvents(Array.isArray(snapshot.events) ? snapshot.events : []);
    } catch {
      setExecutionProgress(null);
      setExecutionEvents([]);
    }
  }, [activeSessionKey]);

  useEffect(() => {
    persistExecutionSnapshot(executionProgress, executionEvents);
  }, [executionProgress, executionEvents, persistExecutionSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const matchesActiveSession = (event: ExecutionProgressEvent & { sessionKey?: string; agentId?: string }) => {
      const active = activeSessionKey.toLowerCase();
      return event.sessionKey?.toLowerCase() === active || event.agentId?.toLowerCase() === active;
    };

    const handleProgress = (customEvent: Event) => {
      const detail = (customEvent as CustomEvent).detail as (ExecutionProgressEvent & { sessionKey?: string; agentId?: string }) | undefined;
      if (!detail?.event) return;
      if (activeThread && detail.sessionKey?.toLowerCase() === activeThread.sessionKey.toLowerCase()) {
        setThreadProgress(detail);
        setThreadEvents((events) => [...events, detail].slice(-40));
        return;
      }
      if (!matchesActiveSession(detail)) return;
      setExecutionProgress(detail);
      setExecutionEvents((events) => [...events, detail].slice(-40));
    };

    window.addEventListener("crewcmd:chat-progress", handleProgress);
    return () => window.removeEventListener("crewcmd:chat-progress", handleProgress);
  }, [activeSessionKey, activeThread]);

  // Server-side /api/chat persists partial content on client disconnect.

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyLocationSearch = () => {
      const params = new URLSearchParams(window.location.search);
      setUrlAgentCallsign(params.get("agent")?.toLowerCase() ?? null);
      setUrlSessionKey(params.get("sessionKey"));
      setUrlMessageId(params.get("messageId"));
    };
    applyLocationSearch();
    window.addEventListener("popstate", applyLocationSearch);
    return () => window.removeEventListener("popstate", applyLocationSearch);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedAgent = window.localStorage.getItem(CHAT_AGENT_STORAGE_KEY);
    const storedSession = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY);

    setPreferredAgentCallsign(storedAgent ? storedAgent.toLowerCase() : null);
    setPreferredSessionKey(storedSession || null);
  }, []);

  // Fetch agents on mount
  useEffect(() => {
    async function fetchAgents() {
      if (!workspace?.id) return;
      try {
        const params = new URLSearchParams({ workspaceId: workspace.id });
        const res = await fetch(`/api/agents?${params.toString()}`);
        const data = await res.json();
        const fetched: Agent[] = Array.isArray(data)
          ? data
          : data.agents || [];
        setAgents(fetched);
        if (fetched.length === 0) {
          setSelectedAgent(null);
          selectSession(null);
          return;
        }

        const targetAgentCallsign = urlAgentCallsign ?? preferredAgentCallsign;
        const targetSessionKey = urlSessionKey ?? preferredSessionKey;
        const restoredAgent = targetAgentCallsign
          ? fetched.find(
              (agent) => agent.callsign.toLowerCase() === targetAgentCallsign
            ) ?? null
          : null;
        const defaultAgent = findDefaultAgent(fetched);

        if (restoredAgent) {
          setSelectedAgent(restoredAgent);
          if (targetSessionKey && (urlSessionKey || !isMessageThreadSessionKey(targetSessionKey))) {
            selectSession(targetSessionKey);
          }
          return;
        }

        if (defaultAgent) {
          setSelectedAgent(defaultAgent);
          if (targetSessionKey) {
            selectSession(null);
          }
        }
      } catch {
        // Agents unavailable
      }
    }
    fetchAgents();
  }, [preferredAgentCallsign, preferredSessionKey, selectSession, urlAgentCallsign, urlSessionKey, workspace?.id]);

  // Load configurable stop words from system settings
  useEffect(() => {
    fetch("/api/system-settings?key=chat.stopWords")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.value) {
          try {
            const parsed = JSON.parse(data.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setStopWords(parsed);
            }
          } catch {
            // Keep defaults
          }
        }
      })
      .catch(() => {
        // Keep defaults
      });
  }, []);

  // Load messages from Zustand store; on first load for an agent, hydrate from gateway history
  const loadedAgentsRef = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const activeKey = activeSessionKey.toLowerCase();

    // Read whatever the store already has (from SSE)
    const storeMessages = useChatStore.getState().messagesByAgent[activeKey] || [];
    if (storeMessages.length > 0 && !cancelled) {
      setMessages(storeMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata,
      })));
    } else {
      setMessages([]);
    }

    // If a gateway session is selected, load its preview
    if (selectedSessionKey) {
      const selectedKey = selectedSessionKey.toLowerCase();
      const selectedLoadKey = `${chatScopeKey}:${selectedKey}`;
      if (!loadedAgentsRef.current.has(selectedLoadKey)) {
        loadedAgentsRef.current.add(selectedLoadKey);
        loadCrewCmdSessionHistoryByKey(selectedSessionKey, chatCompanyId, chatWorkspaceId).then(async (result) => {
          const loaded = result ?? (await loadSessionPreviewIntoStore(selectedSessionKey).then((ok) => ok ? null : null));
          if (cancelled) return;
          const updated = useChatStore.getState().messagesByAgent[selectedKey] || [];
          if (updated.length > 0) {
            setMessages(updated.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.createdAt,
              metadata: m.metadata,
            })));
          }
          if (loaded?.execution) applyExecutionSnapshot(loaded.execution);
          if (loaded?.threadHistory) {
            if (Object.keys(loaded.threadHistory.links).length > 0) {
              setThreadParentLinks((prev) => ({ ...prev, ...loaded.threadHistory.links }));
            }
            setServerThreadSummaries(loaded.threadHistory.summaries);
          }
        });
      }
    } else if (!loadedAgentsRef.current.has(`${chatScopeKey}:${activeKey}`)) {
      // Otherwise load standard thread history
      loadedAgentsRef.current.add(`${chatScopeKey}:${activeKey}`);
      loadCrewCmdSessionHistoryByKey(activeSessionKey, chatCompanyId, chatWorkspaceId).then(async (result) => {
        const loaded = result ?? (await loadSessionPreviewIntoStore(activeSessionKey).then((ok) => ok ? null : null));
        if (cancelled) return;
        const updated = useChatStore.getState().messagesByAgent[activeKey] || [];
        setMessages(updated.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
          metadata: m.metadata,
        })));
        if (loaded?.execution) applyExecutionSnapshot(loaded.execution);
        if (loaded?.threadHistory) {
          if (Object.keys(loaded.threadHistory.links).length > 0) {
            setThreadParentLinks((prev) => ({ ...prev, ...loaded.threadHistory.links }));
          }
          setServerThreadSummaries(loaded.threadHistory.summaries);
        }
      });
    }

    if (chatCompanyId || chatWorkspaceId) {
      void loadThreadHistoriesForParent(activeSessionKey, chatCompanyId, chatWorkspaceId).then(({ links, summaries }) => {
        if (cancelled) return;
        if (Object.keys(links).length > 0) {
          setThreadParentLinks((prev) => ({ ...prev, ...links }));
        }
        setServerThreadSummaries(summaries);
      });
    }

    // Mark as read
    storeMarkRead(activeSessionKey);

    return () => { cancelled = true; };
  }, [activeSessionKey, selectedAgent?.callsign, selectedSessionKey, storeMarkRead, chatCompanyId, chatWorkspaceId, chatScopeKey, applyExecutionSnapshot]);

  useEffect(() => {
    void loadPins();
  }, [loadPins]);

  useEffect(() => {
    const messageIds = messages
      .filter((message) => isUuid(message.id) && isVisibleChatMessage(message))
      .map((message) => message.id);
    const signature = `${chatScopeKey}:${messageIds.join(",")}`;
    if (savedMessageIdsSignatureRef.current === signature) return;
    savedMessageIdsSignatureRef.current = signature;
    void loadSavedMessages(messageIds);
  }, [chatScopeKey, messages, loadSavedMessages]);

  useEffect(() => {
    if (!urlMessageId) return;
    pendingMessageScrollRef.current = urlMessageId;
  }, [urlMessageId]);

  const refreshSessionPreview = useCallback(async (sessionKey: string) => {
    const loaded = await loadSessionPreviewIntoStore(sessionKey);
    if (!loaded) return false;

    const updated = useChatStore.getState().messagesByAgent[sessionKey.toLowerCase()] || [];
    setMessages(updated.map(chatMessageFromStore));
    return true;
  }, []);

  const openThreadForMessage = useCallback((message: Message, index: number, existingSessionKey?: string) => {
    const parentSessionKey = activeSessionKey;
    const parentMessageId = threadParentIdForMessage(message);
    const sessionKey = existingSessionKey ?? threadSessionKey(parentSessionKey, parentMessageId);
    const renderableMessages = messages.filter(hasRenderableMessageContent);
    const contextMessages = renderableMessages.slice(Math.max(0, index - 8), index + 1);
    setThreadParentLinks((prev) => ({
      ...prev,
      [sessionKey.toLowerCase()]: {
        parentSessionKey,
        parentMessageId,
      },
    }));

    setActiveThread({
      sessionKey,
      parentSessionKey,
      parentMessage: message,
      contextMessages,
    });
    setThreadProgress(null);
    setThreadEvents([]);
    setThreadStreamingContent("");

    const existing = useChatStore.getState().messagesByAgent[sessionKey.toLowerCase()] || [];
    setThreadMessages(existing.map(chatMessageFromStore));
    void loadCrewCmdSessionHistoryByKey(sessionKey, chatCompanyId, chatWorkspaceId).then(() => {
      const updated = useChatStore.getState().messagesByAgent[sessionKey.toLowerCase()] || [];
      setThreadMessages(updated.map(chatMessageFromStore));
    });
  }, [activeSessionKey, chatCompanyId, chatWorkspaceId, messages]);

  const closeThread = useCallback(() => {
    const closingThread = activeThread;
    if (closingThread) {
      void loadCrewCmdSessionHistoryByKey(closingThread.sessionKey, chatCompanyId, chatWorkspaceId);
      void loadThreadHistoriesForParent(closingThread.parentSessionKey, chatCompanyId, chatWorkspaceId).then(({ links, summaries }) => {
        if (Object.keys(links).length > 0) {
          setThreadParentLinks((prev) => ({ ...prev, ...links }));
        }
        setServerThreadSummaries(summaries);
      });
    }
    setActiveThread(null);
    setThreadInput("");
    setThreadMessages([]);
    setThreadStreamingContent("");
    setThreadProgress(null);
    setThreadEvents([]);
    if (closingThread && agentModeSessionKey === closingThread.sessionKey) {
      setVoiceMode("off");
      setAgentModeSessionKey(null);
      setAgentMicMuted(false);
      setAgentAudioMuted(false);
    }
  }, [activeThread, agentModeSessionKey, chatCompanyId, chatWorkspaceId]);

  useEffect(() => {
    if (!activeThread) return;
    const key = activeThread.sessionKey.toLowerCase();
    const unsub = useChatStore.subscribe((state) => {
      const storeMessages = state.messagesByAgent[key] || [];
      setThreadMessages(storeMessages.map(chatMessageFromStore));
    });
    return unsub;
  }, [activeThread]);

  useEffect(() => {
    if (!activeThread) return;
    window.requestAnimationFrame(() => scrollThreadToBottom());
  }, [activeThread, threadMessages.length, threadStreamingContent, isThreadLoading, scrollThreadToBottom]);

  // Sync store → local messages when store changes (new messages from SSE)
  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      const storeMessages = state.messagesByAgent[activeSessionKey.toLowerCase()] || [];
      setMessages((prev) => {
        // Only update if store has messages we don't have
        if (storeMessages.length <= prev.length) {
          // Check if the last message IDs match — if so, no update needed
          const lastStore = storeMessages[storeMessages.length - 1];
          const lastLocal = prev[prev.length - 1];
          if (lastStore?.id === lastLocal?.id) return uniqueMessagesById(prev);
        }

        // Merge: keep local optimistic messages ONLY if the store doesn't
        // already contain their server-persisted counterpart. Match on
        // role + content to catch the case where the SSE-delivered real
        // message arrives before the meta event replaces the optimistic ID.
        const storeIds = new Set(storeMessages.map((m) => m.id));
        const storeContentKeys = new Set(
          storeMessages.map((m) => `${m.role}::${m.content}`)
        );
        const optimistic = prev.filter(
          (m) =>
            !storeIds.has(m.id) &&
            m.id.startsWith("optimistic-") &&
            !storeContentKeys.has(`${m.role}::${m.content}`)
        );
        const merged = [
          ...storeMessages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt,
            metadata: m.metadata,
          })),
          ...optimistic,
        ].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

        return uniqueMessagesById(merged);
      });
    });
    return unsub;
  }, [activeSessionKey]);

  // Check if user is near bottom of scroll container
  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Track whether user was at bottom before new content arrives
  const wasAtBottomRef = useRef(true);

  // Update wasAtBottom on scroll events (before React re-renders with new messages)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const trackPosition = () => {
      wasAtBottomRef.current = isNearBottom();
    };
    el.addEventListener("scroll", trackPosition, { passive: true });
    return () => el.removeEventListener("scroll", trackPosition);
  }, [isNearBottom, voiceMode]);

  // Auto-scroll to bottom when new content arrives (if user was already at bottom)
  useEffect(() => {
    if (wasAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

  // Track scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowScrollButton(!isNearBottom());
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isNearBottom, voiceMode]);

  // Scroll to bottom on initial load / session switch / navigate back
  useEffect(() => {
    // Double rAF ensures DOM has rendered messages before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView();
      });
    });
  }, [activeSessionKey]);

  // Also scroll to bottom when messages first load (handles page reload + navigate back)
  const prevMessageCount = useRef(0);
  useEffect(() => {
    if (messages.length > 0 && prevMessageCount.current === 0) {
      // First batch of messages loaded — scroll to bottom
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView();
        });
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Media Session API for background audio
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: selectedAgent?.callsign || "Crew Chat",
        artist: "CrewCmd",
        album: "CrewCmd",
      });
      navigator.mediaSession.setActionHandler("play", () => {
        audioRef.current?.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
      });
    }
  }, [selectedAgent]);

  const agentCallsign = selectedAgent?.callsign || "MAIN";
  const agentEmoji = selectedAgent?.emoji || "💬";
  const agentColor = "var(--accent)";
  const agentIdentityColor = selectedAgent?.color || "var(--accent)";
  const agentAbbrev = agentCallsign.slice(0, 3).toUpperCase();
  const userDisplayName = session?.user?.name || session?.user?.email || "You";
  const userAvatarUrl = session?.user?.image ?? null;
  const assistantDisplayName = selectedAgent?.callsign || selectedAgent?.name || "Agent";
  const assistantAvatarUrl = selectedAgent?.avatarUrl ?? null;
  const userIdentityDetails = useMemo<ChatIdentityDetails>(() => ({
    type: "person",
    title: session?.user?.email || "Workspace member",
    status: "Active in this chat",
    profileHref: "/team",
  }), [session?.user?.email]);
  const assistantIdentityDetails = useMemo<ChatIdentityDetails>(() => ({
    type: "agent",
    title: selectedAgent?.title || selectedAgent?.role || "AI agent",
    status: selectedAgent?.status ?? "idle",
    currentTask: selectedAgent?.currentTask,
    model: selectedAgent?.model,
    runtimeRef: selectedAgent?.runtimeRef ?? selectedAgent?.runtimeId ?? selectedAgent?.adapterType,
    workspacePath: selectedAgent?.workspacePath,
    command: selectedAgent?.callsign ? `/${selectedAgent.callsign.toLowerCase()}` : null,
    profileHref: selectedAgent?.callsign ? `/agents/${selectedAgent.callsign.toLowerCase()}` : "/agents",
  }), [selectedAgent]);

  // Find parent agent for header display
  const parentAgent = useMemo(
    () => (selectedAgent ? findParentAgent(selectedAgent, agents) : null),
    [selectedAgent, agents]
  );
  const defaultAgent = useMemo(() => findDefaultAgent(agents), [agents]);
  const delegatedViaAgent = useMemo(
    () =>
      selectedAgent && defaultAgent && !sameAgent(selectedAgent, defaultAgent)
        ? defaultAgent
        : null,
    [selectedAgent, defaultAgent]
  );
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );
  const activeChannelMembers = useMemo(
    () => activeChannel?.members ?? [],
    [activeChannel]
  );
  const channelAgentMemberById = useMemo(() => {
    const memberById = new Map<string, ChatChannelMember>();
    for (const member of activeChannelMembers) {
      if (member.memberType === "agent" && member.agentId) {
        memberById.set(member.agentId, member);
      }
    }
    return memberById;
  }, [activeChannelMembers]);
  const channelAgentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  );
  const eligibleChannelAgents = useMemo(() => {
    if (!activeChannel) return [];
    const speakingRoles = new Set(["owner", "admin", "member", "contributor"]);
    const speakingModes = new Set(["mention_only", "proactive", "on_call"]);
    return agents.filter((agent) => {
      const membership = channelAgentMemberById.get(agent.id);
      if (!membership) return false;
      if (!speakingRoles.has(membership.role)) return false;
      if (!speakingModes.has(membership.agentParticipationMode ?? "mention_only")) return false;
      if (!chatCompanyId) return true;
      return agent.ownerType === "company" && agent.ownerCompanyId === chatCompanyId;
    });
  }, [activeChannel, agents, channelAgentMemberById, chatCompanyId]);
  const visibleMessages = useMemo(
    () => uniqueMessagesById(
      messages.filter(isVisibleChatMessage)
    ),
    [messages]
  );
  const transcriptItems = useMemo(
    () => uniqueMessagesById(
      messages.filter((message) => isVisibleChatMessage(message) || isHeartbeatAckMessage(message))
    ),
    [messages]
  );
  const hasPersistedExecutionActivity = useMemo(
    () => executionEvents.some((event) => event.activeTool || event.checkpoint),
    [executionEvents]
  );

  const scrollToMessage = useCallback((messageId: string) => {
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`chat-message-${messageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(messageId);
      window.setTimeout(() => {
        setHighlightedMessageId((current) => (current === messageId ? null : current));
      }, 2200);
      pendingMessageScrollRef.current = null;
    });
  }, []);

  useEffect(() => {
    const messageId = pendingMessageScrollRef.current;
    if (!messageId) return;
    if (!visibleMessages.some((message) => message.id === messageId)) return;
    scrollToMessage(messageId);
  }, [scrollToMessage, visibleMessages]);

  const visibleThreadMessages = useMemo(
    () => uniqueMessagesById(threadMessages),
    [threadMessages]
  );
  const threadReplySummaries = useMemo(() => {
    const activeKey = activeSessionKey.toLowerCase();
    const prefix = `${activeKey}:thread:`;
    const summaries: Record<string, ThreadReplySummary> = { ...serverThreadSummaries };

    const assignSummary = (key: string | null | undefined, summary: ThreadReplySummary) => {
      if (!key) return;
      const existing = summaries[key];
      if (!existing || summary.replies.length >= existing.replies.length) {
        summaries[key] = summary;
      }
    };

    for (const [storeKey, storeMessages] of Object.entries(messagesByStoreKey)) {
      const lowerStoreKey = storeKey.toLowerCase();
      if (!lowerStoreKey.startsWith(prefix)) continue;

      const replies = storeMessages
        .filter((reply) => reply.role === "user" || reply.role === "assistant")
        .map((reply) => ({
          id: reply.id,
          role: reply.role as "user" | "assistant",
          createdAt: reply.createdAt,
        }));
      if (replies.length === 0) continue;

      const link = threadParentLinks[lowerStoreKey];
      const summary = { sessionKey: lowerStoreKey, replies };
      if (link?.parentSessionKey.toLowerCase() === activeKey && link.parentMessageId) {
        assignSummary(`id:${link.parentMessageId}`, summary);
        continue;
      }

      const legacyParentId = threadSessionSuffix(activeKey, lowerStoreKey);
      assignSummary(legacyParentId ? `id:${stableThreadLinkId(legacyParentId)}` : null, summary);
    }

    return summaries;
  }, [activeSessionKey, messagesByStoreKey, serverThreadSummaries, threadParentLinks]);

  useEffect(() => {
    if (!company?.id) return;
    registerMobilePushDevice(company.id).catch((error) => {
      console.error("[chat] Mobile push setup failed:", error);
    });
  }, [company?.id]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const isMobileViewport = () =>
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 900;
    const markInterrupted = () => {
      if (isLoading || abortControllerRef.current) {
        pageHiddenDuringRequestRef.current = true;
      }
    };
    const markMobileViewportInterrupted = () => {
      if (isMobileViewport()) markInterrupted();
    };
    const handleVisibility = () => {
      if (document.hidden) {
        markInterrupted();
        updateChatRunVisibility(activeChatRunIdRef.current, "hidden");
      } else {
        updateChatRunVisibility(activeChatRunIdRef.current, "visible");
      }
    };
    const handlePageHide = () => {
      markInterrupted();
      updateChatRunVisibility(activeChatRunIdRef.current, "disconnected");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("orientationchange", markMobileViewportInterrupted);
    window.addEventListener("resize", markMobileViewportInterrupted);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("orientationchange", markMobileViewportInterrupted);
      window.removeEventListener("resize", markMobileViewportInterrupted);
    };
  }, [isLoading]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const shouldRecover = () =>
      !isLoading && (
        pageHiddenDuringRequestRef.current ||
        executionProgress?.event === "connection_interrupted" ||
        executionProgress?.event === "connection_recovering"
      );

    const recover = () => {
      if (document.hidden || !shouldRecover()) return;
      const recoverProgress = {
        event: "connection_recovering",
        at: new Date().toISOString(),
        error: "Rehydrating CrewCMD from persisted session history.",
      };
      setExecutionProgress(recoverProgress);
      setExecutionEvents((events) => [...events, recoverProgress]);
      useActiveChatRunStore.getState().applyProgressEvent({
        type: "chat_progress",
        event: "connection_recovering",
        at: recoverProgress.at,
        sessionKey: activeSessionKey,
      });
      void refreshSessionPreview(activeSessionKey).then((loaded) => {
        if (!loaded) return;
        pageHiddenDuringRequestRef.current = false;
        setStreamingContent("");
        streamingContentRef.current = "";
        const completedProgress = {
          event: "run_completed",
          at: new Date().toISOString(),
        };
        setExecutionProgress(completedProgress);
        setExecutionEvents((events) => [...events, completedProgress]);
        useActiveChatRunStore.getState().applyProgressEvent({
          type: "chat_progress",
          event: "run_completed",
          at: completedProgress.at,
          sessionKey: activeSessionKey,
        });
      });
    };

    document.addEventListener("visibilitychange", recover);
    window.addEventListener("pageshow", recover);
    window.addEventListener("focus", recover);
    return () => {
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("pageshow", recover);
      window.removeEventListener("focus", recover);
    };
  }, [activeSessionKey, executionProgress?.event, isLoading, refreshSessionPreview]);

  const handleAgentSelect = useCallback(
    (agent: Agent, sessionKey?: string | null) => {
      const nextSessionKey = sessionKey ?? null;
      if (agent.id === selectedAgent?.id && nextSessionKey === selectedSessionKey) return;
      // Abort any in-flight streaming to prevent cross-agent bleed
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      queuedMainMessagesRef.current = [];
      setMainLoading(false);
      setStreamingContent("");
      setExecutionProgress(null);
      setExecutionEvents([]);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlayingAudio(false);
      // Clear messages immediately so previous agent's thread doesn't bleed
      setMessages([]);
      // Update session selection (or clear it for regular agent mode)
      selectSession(nextSessionKey);
      if (typeof window !== "undefined" && !nextSessionKey) {
        window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
      }
      setSelectedAgent(agent);
    },
    [selectedAgent, selectedSessionKey, selectSession, setMainLoading]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedAgent?.callsign) return;

    window.localStorage.setItem(
      CHAT_AGENT_STORAGE_KEY,
      selectedAgent.callsign.toLowerCase()
    );
  }, [selectedAgent]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selectedSessionKey) {
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, selectedSessionKey);
      return;
    }

    window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
  }, [selectedSessionKey]);

  const ttsModRef = useRef<"server" | "browser" | "native" | "disabled" | "unknown">("unknown");

  // Probe TTS availability on mount
  useEffect(() => {
    if (isNativeCapacitorApp()) {
      ttsModRef.current = "server";
      recordTtsBreadcrumb("availability.native-speech", { selectedMode: ttsModRef.current });
      return;
    }

    fetch("/api/tts")
      .then((res) => {
        ttsModRef.current = res.ok ? "server" : "browser";
        recordTtsBreadcrumb("availability.probe", { ok: res.ok, status: res.status, selectedMode: ttsModRef.current });
      })
      .catch(() => {
        ttsModRef.current = "browser";
        recordTtsBreadcrumb("availability.probe.error", { selectedMode: ttsModRef.current });
      });
  }, [recordTtsBreadcrumb]);

  // Agent mode: speak acknowledgment when thinking starts, check-in after 30s
  const thinkingAcks = useMemo(
    () => [
      "Let me think about that.",
      "Working on it.",
      "Give me a moment.",
      "One second.",
      "On it.",
    ],
    []
  );

  useEffect(() => {
    if (isLoading && voiceMode === "agent") {
      loadingStartRef.current = Date.now();
      fillerAudioTokenRef.current++;

      thinkingAckTimerRef.current = setTimeout(() => {
        if (!firstDeltaSeenRef.current && !isSpeakingQueueRef.current) {
          const ack = thinkingAcks[Math.floor(Math.random() * thinkingAcks.length)];
          playTTS(ack, { kind: "filler" });
        }
      }, VOICE_ACK_DELAY_MS);

      thinkingTimerRef.current = setTimeout(() => {
        if (!firstDeltaSeenRef.current && !isSpeakingQueueRef.current) {
          playTTS("Still working on this.", { kind: "filler" });
        }
      }, VOICE_CHECKIN_DELAY_MS);
    }

    return () => {
      if (thinkingAckTimerRef.current) {
        clearTimeout(thinkingAckTimerRef.current);
        thinkingAckTimerRef.current = null;
      }
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
    // playTTS intentionally omitted to avoid re-firing on TTS ref changes
     
  }, [isLoading, voiceMode, thinkingAcks]);

  // Escape key cancels in-flight chat request
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLoading && abortControllerRef.current) {
        e.preventDefault();
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        stopAllAudio();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isLoading]);

  // Stop all audio playback (server TTS, browser TTS, queued sentences)
  const stopAllAudio = useCallback(() => {
    recordTtsBreadcrumb("stop-all-audio");
    if (!isNativeCapacitorApp()) {
      window.speechSynthesis?.cancel();
    } else {
      void stopNativeVoiceAudio().catch((error) => {
        recordTtsBreadcrumb("native-audio.stop.error", { message: error instanceof Error ? error.message : String(error) });
      });
    }
    ttsQueueRef.current = [];
    isSpeakingQueueRef.current = false;
    activeAudioKindRef.current = null;
    fillerAudioTokenRef.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    revokeAudioObjectUrl(audioObjectUrlRef.current, "stop-all-audio");
    revokePrefetchedAudio("stop-all-audio");
  }, [recordTtsBreadcrumb, revokeAudioObjectUrl, revokePrefetchedAudio]);

  const stopFillerAudio = useCallback(() => {
    fillerAudioTokenRef.current++;
    if (activeAudioKindRef.current !== "filler") return;
    recordTtsBreadcrumb("stop-filler-audio");
    if (!isNativeCapacitorApp()) {
      window.speechSynthesis?.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    revokeAudioObjectUrl(audioObjectUrlRef.current, "stop-filler-audio");
    activeAudioKindRef.current = null;
    setIsPlayingAudio(false);
  }, [recordTtsBreadcrumb, revokeAudioObjectUrl]);

  useEffect(() => {
    return () => stopAllAudio();
  }, [stopAllAudio]);

  const markFirstAudioStarted = useCallback((provider: "browser" | "server" | "native") => {
    const metrics = voiceLatencyRef.current;
    if (!metrics || metrics.firstAudioStartedAt) return;
    metrics.firstAudioStartedAt = performance.now();
    console.debug("[voice-latency]", {
      requestId: metrics.requestId,
      firstDeltaMs: metrics.firstDeltaAt
        ? Math.round(metrics.firstDeltaAt - metrics.startedAt)
        : null,
      firstSentenceQueuedMs: metrics.firstSentenceQueuedAt
        ? Math.round(metrics.firstSentenceQueuedAt - metrics.startedAt)
        : null,
      firstAudioStartedMs: Math.round(metrics.firstAudioStartedAt - metrics.startedAt),
      provider,
    });
    recordTtsBreadcrumb("first-audio-started", { provider });
  }, [recordTtsBreadcrumb]);

  const playBrowserTTS = useCallback((text: string, kind: "filler" | "response" = "filler", token?: number) => {
    if (isNativeCapacitorApp()) {
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
      return;
    }
    if (!("speechSynthesis" in window)) {
      setIsPlayingAudio(false);
      return;
    }

    // Cancel any in-progress speech
    window.speechSynthesis.cancel();

    activeAudioKindRef.current = kind;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = resolvedVoiceSettings.speed ?? 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = (resolvedVoiceSettings.voiceId || resolvedVoiceSettings.voiceName) &&
      shouldUseDeviceTts(resolvedVoiceSettings)
      ? voices.find((v) =>
          v.voiceURI === resolvedVoiceSettings.voiceId ||
          v.name === resolvedVoiceSettings.voiceId ||
          v.name === resolvedVoiceSettings.voiceName
        )
      : null;
    const preferred = selectedVoice || voices.find(
      (v) => v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Daniel") || v.name.includes("Google") || v.name.includes("Neural"))
    ) || voices.find((v) => v.lang.startsWith("en") && v.localService);
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => {
      if (kind === "response") markFirstAudioStarted("browser");
    };
    utterance.onend = () => {
      if (token && token !== fillerAudioTokenRef.current) return;
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
    };
    utterance.onerror = () => {
      if (token && token !== fillerAudioTokenRef.current) return;
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
    };

    window.speechSynthesis.speak(utterance);
  }, [markFirstAudioStarted, resolvedVoiceSettings]);

  const playTTS = useCallback(async (
    text: string,
    options: { kind?: "filler" | "response" } = {}
  ) => {
    const kind = options.kind ?? "filler";
    const token = kind === "filler" ? fillerAudioTokenRef.current : undefined;
    const usesExplicitServerVoice = isExplicitServerVoice(resolvedVoiceSettings);
    const useDeviceSpeech = shouldUseDeviceTts(resolvedVoiceSettings);
    try {
      if (resolvedVoiceSettings.enabled === false) {
        recordTtsBreadcrumb("play.voice-disabled", { kind });
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
        return;
      }

      recordTtsBreadcrumb("play.start", { kind, characters: text.length, voiceProvider: resolvedVoiceSettings.provider, voiceId: resolvedVoiceSettings.voiceId });
      setIsPlayingAudio(true);
      activeAudioKindRef.current = kind;

      if (ttsModRef.current === "disabled" && !usesExplicitServerVoice) {
        recordTtsBreadcrumb("play.disabled", { kind });
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
        return;
      }

      if (isNativeCapacitorApp() && (useDeviceSpeech || (ttsModRef.current === "native" && resolvedVoiceSettings.provider === "auto"))) {
        if (kind === "filler" && token !== fillerAudioTokenRef.current) {
          recordTtsBreadcrumb("native-speech.stale-filler", { characters: text.length });
          return;
        }

        recordTtsBreadcrumb("native-speech.play.start", { kind, characters: text.length });
        const status = await speakNativeVoiceText({
          text,
          playbackRate: resolvedVoiceSettings.speed ?? (kind === "response" ? 1.15 : 1),
          voiceId: resolvedVoiceSettings.voiceId,
          voiceName: resolvedVoiceSettings.voiceName,
        });
        if (!status) {
          recordTtsBreadcrumb("native-speech.unavailable", { kind });
          setIsPlayingAudio(false);
          activeAudioKindRef.current = null;
          return;
        }

        if (kind === "response") markFirstAudioStarted("native");
        recordTtsBreadcrumb("native-speech.play.complete", { kind, status });
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
        return;
      }

      // If server TTS is unavailable, or this session prefers a device/browser voice, go straight to browser speech.
      if ((ttsModRef.current === "browser" && !usesExplicitServerVoice) || useDeviceSpeech) {
        recordTtsBreadcrumb("play.browser-fallback", { kind });
        playBrowserTTS(text, kind, token);
        return;
      }

      recordTtsBreadcrumb("server.fetch.start", { kind, characters: text.length });
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: resolvedVoiceSettings }),
      });

      if (response.status === 503) {
        recordTtsBreadcrumb("server.fetch.unavailable", { kind, status: response.status });
        if (isNativeCapacitorApp()) {
          if (!usesExplicitServerVoice) {
            ttsModRef.current = resolvedVoiceSettings.provider === "auto" ? "native" : "disabled";
          }
          if (resolvedVoiceSettings.provider === "auto") {
            await speakNativeVoiceText({
              text,
              playbackRate: resolvedVoiceSettings.speed ?? (kind === "response" ? 1.15 : 1),
              voiceId: resolvedVoiceSettings.voiceId,
              voiceName: resolvedVoiceSettings.voiceName,
            });
            setIsPlayingAudio(false);
            activeAudioKindRef.current = null;
          } else {
            console.log("[TTS] Server unavailable; no native fallback for explicit server voice");
            setIsPlayingAudio(false);
            activeAudioKindRef.current = null;
          }
        } else {
          if (usesExplicitServerVoice) {
            console.log("[TTS] Server unavailable; no browser fallback for explicit server voice");
            setIsPlayingAudio(false);
            activeAudioKindRef.current = null;
          } else {
            // Server has no TTS backend, switch to browser mode
            console.log("[TTS] Server unavailable, using browser speechSynthesis");
            ttsModRef.current = "browser";
            playBrowserTTS(text, kind, token);
          }
        }
        return;
      }

      if (!response.ok) {
        recordTtsBreadcrumb("server.fetch.error", { kind, status: response.status });
        console.error("[TTS] Error:", response.status);
        setIsPlayingAudio(false);
        return;
      }

      const blob = await response.blob();
      recordTtsBreadcrumb("server.blob.ready", { kind, bytes: blob.size, type: blob.type || null });
      if (isNativeCapacitorApp()) {
        const dataBase64 = await blobToBase64(blob);
        const status = await playNativeVoiceAudio({
          dataBase64,
          contentType: blob.type || response.headers.get("Content-Type") || "audio/mpeg",
          playbackRate: resolvedVoiceSettings.speed ?? (kind === "response" ? 1.15 : 1),
        });
        if (kind === "response") markFirstAudioStarted("native");
        recordTtsBreadcrumb("native-audio.play.complete", { kind, status });
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
        return;
      }

      const url = URL.createObjectURL(blob);
      publishAgentModeDiagnostic({
        scope: "chat-tts",
        event: "object-url.create",
        sessionId: ttsSessionRef.current,
        detail: { kind, bytes: blob.size, source: "playTTS" },
      });
      if (kind === "filler" && token !== fillerAudioTokenRef.current) {
        recordTtsBreadcrumb("play.stale-filler", { bytes: blob.size });
        revokeAudioObjectUrl(url, "stale-filler-token");
        return;
      }

      if (audioRef.current) {
        recordTtsBreadcrumb("webview-audio.play.start", { kind, bytes: blob.size });
        assignAudioObjectUrl(url, `play-${kind}`);
        audioRef.current.src = url;
        audioRef.current.onended = () => {
          recordTtsBreadcrumb("webview-audio.play.ended", { kind });
          setIsPlayingAudio(false);
          activeAudioKindRef.current = null;
          revokeAudioObjectUrl(url, "play-ended");
        };
        audioRef.current.onerror = () => {
          recordTtsBreadcrumb("webview-audio.play.error", { kind });
          setIsPlayingAudio(false);
          activeAudioKindRef.current = null;
          revokeAudioObjectUrl(url, "play-error");
        };
        await audioRef.current.play();
        recordTtsBreadcrumb("webview-audio.play.resolved", { kind });
        if (kind === "response") markFirstAudioStarted("server");
      } else {
        recordTtsBreadcrumb("webview-audio.missing-element", { kind });
        revokeAudioObjectUrl(url, "missing-audio-element");
      }
    } catch (error) {
      recordTtsBreadcrumb("play.exception", { message: error instanceof Error ? error.message : String(error) });
      console.error("[TTS] Error:", error);
      revokeAudioObjectUrl(audioObjectUrlRef.current, "play-exception");
      if (isNativeCapacitorApp()) {
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
        return;
      }
      // Network error — try browser fallback on regular web only when it can honor the selected voice class.
      if (usesExplicitServerVoice) {
        setIsPlayingAudio(false);
        activeAudioKindRef.current = null;
      } else {
        playBrowserTTS(text, kind, token);
      }
    }
  }, [assignAudioObjectUrl, markFirstAudioStarted, playBrowserTTS, recordTtsBreadcrumb, resolvedVoiceSettings, revokeAudioObjectUrl]);

  const prefetchTTS = useCallback(async (text: string) => {
    if (isNativeCapacitorApp()) return;
    try {
      if (resolvedVoiceSettings.enabled === false || shouldUseDeviceTts(resolvedVoiceSettings)) return;
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: resolvedVoiceSettings }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      publishAgentModeDiagnostic({
        scope: "chat-tts",
        event: "object-url.create",
        sessionId: ttsSessionRef.current,
        detail: { bytes: blob.size, source: "prefetchTTS" },
      });
      revokePrefetchedAudio("replace-prefetch");
      prefetchedAudioRef.current = { text, url };
    } catch {
      // Prefetch is best-effort
    }
  }, [resolvedVoiceSettings, revokePrefetchedAudio]);

  // Sentence-level TTS: speak each sentence as it completes during streaming
  const speakNextInQueue = useCallback(async () => {
    if (isSpeakingQueueRef.current) return;
    if (resolvedVoiceSettings.enabled === false) {
      recordTtsBreadcrumb("queue.voice-disabled");
      ttsQueueRef.current = [];
      isSpeakingQueueRef.current = false;
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
      return;
    }
    const next = ttsQueueRef.current.shift();
    if (!next) {
      isSpeakingQueueRef.current = false;
      return;
    }
    const usesExplicitServerVoice = isExplicitServerVoice(resolvedVoiceSettings);
    const useDeviceSpeech = shouldUseDeviceTts(resolvedVoiceSettings);

    if (ttsModRef.current === "disabled" && !usesExplicitServerVoice) {
      recordTtsBreadcrumb("queue.disabled");
      ttsQueueRef.current = [];
      isSpeakingQueueRef.current = false;
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
      return;
    }
    stopFillerAudio();
    recordTtsBreadcrumb("queue.play.start", { characters: next.length, remaining: ttsQueueRef.current.length });
    isSpeakingQueueRef.current = true;
    activeAudioKindRef.current = "response";
    setIsPlayingAudio(true);

    // Kick off prefetch of the NEXT sentence while this one plays
    const upcoming = ttsQueueRef.current[0];
    if (upcoming && (ttsModRef.current !== "browser" || usesExplicitServerVoice)) {
      prefetchTTS(upcoming);
    }

    try {
      const browserSpeechAllowed =
        !isNativeCapacitorApp() &&
        "speechSynthesis" in window;
      const useBrowserForFastStart =
        !usesExplicitServerVoice &&
        !hasStartedResponseAudioRef.current &&
        browserSpeechAllowed &&
        !useDeviceSpeech &&
        resolvedVoiceSettings.provider !== "browser";

      if (browserSpeechAllowed && ((ttsModRef.current === "browser" && !usesExplicitServerVoice) || useDeviceSpeech || useBrowserForFastStart)) {
        hasStartedResponseAudioRef.current = true;
        // Browser TTS with queue continuation
        if (browserSpeechAllowed) {
          let browserSpeechStarted = false;
          let browserSpeechSettled = false;
          const continueQueue = () => {
            isSpeakingQueueRef.current = false;
            if (ttsQueueRef.current.length > 0) {
              speakNextInQueue();
            } else {
              activeAudioKindRef.current = null;
              setIsPlayingAudio(false);
            }
          };
          const fallbackToServerTTS = () => {
            if (browserSpeechSettled || browserSpeechStarted || ttsModRef.current === "browser") return;
            browserSpeechSettled = true;
            window.speechSynthesis.cancel();
            ttsQueueRef.current.unshift(next);
            isSpeakingQueueRef.current = false;
            activeAudioKindRef.current = null;
            speakNextInQueue();
          };
          const utterance = new SpeechSynthesisUtterance(next);
          utterance.rate = resolvedVoiceSettings.speed ?? 1.15;
          const voices = window.speechSynthesis.getVoices();
          const selectedVoice = (resolvedVoiceSettings.voiceId || resolvedVoiceSettings.voiceName) &&
            useDeviceSpeech
            ? voices.find((v) =>
                v.voiceURI === resolvedVoiceSettings.voiceId ||
                v.name === resolvedVoiceSettings.voiceId ||
                v.name === resolvedVoiceSettings.voiceName
              )
            : null;
          const preferred = selectedVoice || voices.find(
            (v) => v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Daniel") || v.name.includes("Google") || v.name.includes("Neural"))
          ) || voices.find((v) => v.lang.startsWith("en") && v.localService);
          if (preferred) utterance.voice = preferred;
          utterance.onstart = () => {
            browserSpeechStarted = true;
            markFirstAudioStarted("browser");
          };
          utterance.onend = () => {
            if (browserSpeechSettled) return;
            browserSpeechSettled = true;
            continueQueue();
          };
          utterance.onerror = () => {
            if (browserSpeechSettled) return;
            if (useBrowserForFastStart && ttsModRef.current !== "browser") {
              fallbackToServerTTS();
              return;
            }
            browserSpeechSettled = true;
            activeAudioKindRef.current = null;
            isSpeakingQueueRef.current = false;
            setIsPlayingAudio(false);
          };
          speechSynthesis.speak(utterance);
          if (useBrowserForFastStart) {
            window.setTimeout(fallbackToServerTTS, 450);
          }
        }
        return;
      }

      // Check if we have a prefetched audio for this exact sentence
      hasStartedResponseAudioRef.current = true;
      if (isNativeCapacitorApp() && (useDeviceSpeech || (ttsModRef.current === "native" && resolvedVoiceSettings.provider === "auto"))) {
        revokePrefetchedAudio("native-queue-play");
        recordTtsBreadcrumb("queue.native-speech.play.start", { characters: next.length });
        const status = await speakNativeVoiceText({
          text: next,
          playbackRate: resolvedVoiceSettings.speed ?? 1.15,
          voiceId: resolvedVoiceSettings.voiceId,
          voiceName: resolvedVoiceSettings.voiceName,
        });

        if (!status) {
          recordTtsBreadcrumb("queue.native-speech.unavailable");
          isSpeakingQueueRef.current = false;
          activeAudioKindRef.current = null;
          setIsPlayingAudio(false);
          return;
        }

        markFirstAudioStarted("native");
        recordTtsBreadcrumb("queue.native-speech.play.complete", { status });
        isSpeakingQueueRef.current = false;
        if (ttsQueueRef.current.length > 0) {
          speakNextInQueue();
        } else {
          activeAudioKindRef.current = null;
          setIsPlayingAudio(false);
        }
        return;
      }

      let url: string;
      if (prefetchedAudioRef.current?.text === next) {
        url = prefetchedAudioRef.current.url;
        prefetchedAudioRef.current = null;
      } else {
        // Fetch fresh
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: next, voice: resolvedVoiceSettings }),
        });

        if (!response.ok) {
          recordTtsBreadcrumb("queue.fetch.error", { status: response.status });
          if (response.status === 503 && isNativeCapacitorApp()) {
            ttsModRef.current = resolvedVoiceSettings.provider === "auto" ? "native" : "disabled";
            if (resolvedVoiceSettings.provider === "auto") {
              const status = await speakNativeVoiceText({
                text: next,
                playbackRate: resolvedVoiceSettings.speed ?? 1.15,
                voiceId: resolvedVoiceSettings.voiceId,
                voiceName: resolvedVoiceSettings.voiceName,
              });
              markFirstAudioStarted("native");
              recordTtsBreadcrumb("queue.native-speech.fallback.complete", { status });
              isSpeakingQueueRef.current = false;
              activeAudioKindRef.current = null;
              if (ttsQueueRef.current.length > 0) {
                speakNextInQueue();
              } else {
                setIsPlayingAudio(false);
              }
              return;
            }
          }
          isSpeakingQueueRef.current = false;
          activeAudioKindRef.current = null;
          setIsPlayingAudio(false);
          return;
        }

        const blob = await response.blob();
        recordTtsBreadcrumb("queue.blob.ready", { bytes: blob.size, type: blob.type || null });
        if (isNativeCapacitorApp()) {
          const status = await playNativeVoiceAudio({
            dataBase64: await blobToBase64(blob),
            contentType: blob.type || response.headers.get("Content-Type") || "audio/mpeg",
            playbackRate: resolvedVoiceSettings.speed ?? 1.15,
          });
          markFirstAudioStarted("native");
          recordTtsBreadcrumb("queue.native-audio.play.complete", { status });
          isSpeakingQueueRef.current = false;
          if (ttsQueueRef.current.length > 0) {
            speakNextInQueue();
          } else {
            activeAudioKindRef.current = null;
            setIsPlayingAudio(false);
          }
          return;
        }

        url = URL.createObjectURL(blob);
        publishAgentModeDiagnostic({
          scope: "chat-tts",
          event: "object-url.create",
          sessionId: ttsSessionRef.current,
          detail: { bytes: blob.size, source: "queue" },
        });
      }

      if (audioRef.current) {
        recordTtsBreadcrumb("queue.webview-audio.play.start");
        assignAudioObjectUrl(url, "queue-play");
        audioRef.current.src = url;
        audioRef.current.playbackRate = resolvedVoiceSettings.speed ?? 1.15;
        audioRef.current.onended = () => {
          recordTtsBreadcrumb("queue.webview-audio.play.ended");
          revokeAudioObjectUrl(url, "queue-ended");
          isSpeakingQueueRef.current = false;
          if (ttsQueueRef.current.length > 0) {
            speakNextInQueue();
          } else {
            activeAudioKindRef.current = null;
            setIsPlayingAudio(false);
          }
        };
        audioRef.current.onerror = () => {
          recordTtsBreadcrumb("queue.webview-audio.play.error");
          revokeAudioObjectUrl(url, "queue-error");
          isSpeakingQueueRef.current = false;
          activeAudioKindRef.current = null;
          setIsPlayingAudio(false);
        };
        await audioRef.current.play();
        recordTtsBreadcrumb("queue.webview-audio.play.resolved");
        markFirstAudioStarted("server");
      } else {
        recordTtsBreadcrumb("queue.webview-audio.missing-element");
        console.error("[TTS Queue] No audioRef.current available");
        revokeAudioObjectUrl(url, "missing-audio-element");
        isSpeakingQueueRef.current = false;
        activeAudioKindRef.current = null;
        setIsPlayingAudio(false);
      }
    } catch (err) {
      recordTtsBreadcrumb("queue.play.exception", { message: err instanceof Error ? err.message : String(err) });
      console.error("[TTS Queue] Playback error:", err);
      revokeAudioObjectUrl(audioObjectUrlRef.current, "queue-exception");
      isSpeakingQueueRef.current = false;
      activeAudioKindRef.current = null;
      setIsPlayingAudio(false);
    }
  }, [assignAudioObjectUrl, markFirstAudioStarted, prefetchTTS, recordTtsBreadcrumb, resolvedVoiceSettings, revokeAudioObjectUrl, revokePrefetchedAudio, stopFillerAudio]);

  /** Queue a sentence for TTS and start speaking if idle */
  const queueSentenceForTTS = useCallback(
    (sentence: string) => {
      const cleaned = sentence.trim();
      if (!cleaned) return;
      if (voiceLatencyRef.current && !voiceLatencyRef.current.firstSentenceQueuedAt) {
        voiceLatencyRef.current.firstSentenceQueuedAt = performance.now();
      }
      ttsQueueRef.current.push(cleaned);
      if (!isSpeakingQueueRef.current) {
        speakNextInQueue();
      }
    },
    [speakNextInQueue]
  );

  const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv";

  const addFiles = useCallback((files: FileList | File[]) => {
    const allowed = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type) && f.size <= 10 * 1024 * 1024);
    if (allowed.length) setPendingFiles((prev) => [...prev, ...allowed]);
  }, []);

  const addThreadFiles = useCallback((files: FileList | File[]) => {
    const allowed = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type) && f.size <= 10 * 1024 * 1024);
    if (allowed.length) setThreadPendingFiles((prev) => [...prev, ...allowed]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeThreadFile = useCallback((index: number) => {
    setThreadPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Upload a single file and return attachment metadata */
  async function uploadFile(file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  }

  const sendMessage = useCallback(
    async (
      text: string,
      options: {
        forceVoiceResponse?: boolean;
        fromQueue?: boolean;
        queuedMessageId?: string;
        files?: File[];
      } = {}
    ) => {
      const trimmed = text.trim();
      const filesForMessage = options.files ?? pendingFiles;
      const hasFiles = filesForMessage.length > 0;
      if (!trimmed && !hasFiles) return;

      if (isLoadingRef.current && !options.fromQueue) {
        enqueueMainMessage(trimmed, filesForMessage, options);
        return;
      }

      // --- Wake word detection: check if user is addressing a specific agent ---
      const lowerTrimmed = trimmed.toLowerCase();
      let wakeAgent: Agent | null = null;
      const mentionableAgents = activeChannelId ? eligibleChannelAgents : agents;
      for (const agent of mentionableAgents) {
        const callsign = agent.callsign.toLowerCase();
        const name = agent.name.toLowerCase();
        // Match patterns: @callsign, "callsign," , "callsign " at start, "hey callsign", "hey name"
        const patterns = [
          new RegExp(`^@${callsign}\\b`, "i"),
          new RegExp(`^@${name}\\b`, "i"),
          new RegExp(`^${callsign}[,:\\s]`, "i"),
          new RegExp(`^${name}[,:\\s]`, "i"),
          new RegExp(`^hey\\s+${callsign}\\b`, "i"),
          new RegExp(`^hey\\s+${name}\\b`, "i"),
          new RegExp(`\\b@${callsign}\\b`, "i"),
          new RegExp(`\\b@${name}\\b`, "i"),
        ];
        if (patterns.some((p) => p.test(trimmed))) {
          wakeAgent = agent;
          break;
        }
      }

      // If wake word detected, switch agent and/or unpause
      if (wakeAgent) {
        if (wakeAgent.id !== selectedAgent?.id) {
          setStreamingContent("");
          setSelectedAgent(wakeAgent);
        }
        if (isPaused) {
          setIsPaused(false);
        }
        // Don't return — continue sending the message to the (now-active) agent
      }

      // --- Stop word detection: check if entire message is a stop phrase ---
      if (!wakeAgent && stopWords.some((sw) => lowerTrimmed === sw.toLowerCase())) {
        // Show user message in chat
        const userMsg: Message = {
          id: createClientId(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");

        // Show system-style pause message
        const pauseMsg: Message = {
          id: createClientId(),
          role: "assistant",
          content: "Agent paused. Type a message or say their name to resume.",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, pauseMsg]);
        setIsPaused(true);
        return;
      }

      // --- Paused state: show message locally but don't forward to gateway ---
      if (isPaused && !wakeAgent) {
        const userMsg: Message = {
          id: createClientId(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
          metadata: pendingFiles.length > 0 ? { attachments: [] } : null,
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        // Server will persist via /api/chat — no client-side persistMessage needed
        return;
      }

      // Slash command: /task <title>
      if (trimmed.startsWith("/task ")) {
        const taskTitle = trimmed.slice(6).trim();
        if (!taskTitle) return;

        const userMsg: Message = {
          id: createClientId(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        wasAtBottomRef.current = true;
        setInput("");
        setMainLoading(true);
        const startedProgress = {
          event: "run_started",
          at: new Date().toISOString(),
          elapsedMs: 0,
        };
        setExecutionProgress(startedProgress);
        setExecutionEvents([startedProgress]);

        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: taskTitle,
              status: "queued",
              priority: "medium",
              source: "manual",
              createdBy: "chat",
            }),
          });
          const task = await res.json();
          const marker = `<!--task_card ${JSON.stringify({
            id: task.id,
            shortId: task.shortId,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assignedAgentId: task.assignedAgentId,
          })} -->`;

          const assistantContent = `Task created: "${task.title}"\n\n${marker}`;
          const aMsg: Message = {
            id: createClientId(),
            role: "assistant",
            content: assistantContent,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, aMsg]);
          // Persist slash command messages via API (not going through /api/chat SSE)
          if (chatCompanyId || chatWorkspaceId) {
            fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId: agentCallsign, companyId: chatCompanyId, workspaceId: chatWorkspaceId, channelId: activeChannelId, role: "user", content: trimmed }),
            }).catch(() => {});
            fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId: agentCallsign, companyId: chatCompanyId, workspaceId: chatWorkspaceId, channelId: activeChannelId, role: "assistant", content: assistantContent }),
            }).catch(() => {});
          }
        } catch {
          const errorProgress = {
            event: "run_error",
            at: new Date().toISOString(),
            error: "Failed to create task.",
          };
          setExecutionProgress(errorProgress);
          setExecutionEvents((events) => [...events, errorProgress]);
          setMessages((prev) => [
            ...prev,
            {
              id: createClientId(),
              role: "assistant",
              content: "Failed to create task. Check your connection.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        setMainLoading(false);
        setExecutionProgress((current) =>
          current?.event === "run_error"
            ? current
            : {
                event: "run_completed",
                at: new Date().toISOString(),
              }
        );
        const nextQueued = queuedMainMessagesRef.current.shift();
        if (nextQueued) {
          window.setTimeout(() => {
            void sendMessage(nextQueued.text, {
              ...nextQueued.options,
              fromQueue: true,
              queuedMessageId: nextQueued.id,
              files: nextQueued.files,
            });
          }, 0);
        }
        return;
      }

      // Upload pending files
      let attachments: Attachment[] = [];
      const filesToUpload = [...filesForMessage];
      if (!options.fromQueue) setPendingFiles([]);

      if (filesToUpload.length > 0) {
        try {
          attachments = await Promise.all(filesToUpload.map(uploadFile));
        } catch (err) {
          console.error("[chat] File upload failed:", err);
          if (!options.fromQueue) setPendingFiles(filesToUpload); // restore on failure
          return;
        }
      }

      // Build message content — append attachment refs as markdown for the gateway
      let messageContent = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) =>
          a.mimeType.startsWith("image/")
            ? `![${a.filename}](${a.url})`
            : `[${a.filename}](${a.url})`
        ).join("\n");
        messageContent = messageContent ? `${messageContent}\n\n${refs}` : refs;
      }

      const metadata = attachments.length > 0 ? { attachments } : null;
      const respondingAgent = wakeAgent ?? selectedAgent;
      const respondingDelegatedViaAgent = wakeAgent && defaultAgent && !sameAgent(wakeAgent, defaultAgent)
        ? defaultAgent
        : delegatedViaAgent;
      const respondingAgentCallsign = agentDisplayCallsign(respondingAgent);
      const requestSessionKey = respondingDelegatedViaAgent
        ? gatewaySessionKeyForAgent(respondingDelegatedViaAgent)
        : selectedSessionBelongsToAgent(selectedSessionKey, respondingAgent?.callsign)
        ? selectedSessionKey ?? gatewaySessionKeyForAgent(respondingAgent)
        : gatewaySessionKeyForAgent(respondingAgent);

      // Send to OpenClaw Gateway — optimistic local message (replaced by server version via SSE)
      const optimisticId = `optimistic-${createClientId()}`;
      const userMsg: Message = {
        id: optimisticId,
        role: "user",
        content: trimmed || "(attachments)",
        createdAt: new Date().toISOString(),
        metadata,
      };
      useChatStore.getState().addMessage({
        id: optimisticId,
        agentId: requestSessionKey,
        role: "user",
        content: userMsg.content,
        metadata,
        createdAt: userMsg.createdAt ?? new Date().toISOString(),
      });
      setMessages((prev) =>
        options.queuedMessageId
          ? prev.map((message) => message.id === options.queuedMessageId ? { ...userMsg } : message)
          : [...prev, userMsg]
      );
      // Always scroll to bottom when user sends a message
      wasAtBottomRef.current = true;
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      // User message persisted server-side in /api/chat route
      setInput("");
      if (activeChannelId && !wakeAgent) {
        if (chatCompanyId || chatWorkspaceId) {
          try {
            const res = await fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agentId: respondingAgentCallsign,
                companyId: chatCompanyId,
                workspaceId: chatWorkspaceId,
                channelId: activeChannelId,
                role: "user",
                content: userMsg.content,
                metadata,
              }),
            });
            const data = await res.json().catch(() => ({})) as { message?: { id?: string } };
            if (res.ok && data.message?.id) {
              useChatStore.getState().replaceOptimisticMessage(requestSessionKey, optimisticId, {
                ...userMsg,
                id: data.message.id,
                agentId: requestSessionKey,
                createdAt: userMsg.createdAt ?? new Date().toISOString(),
              });
              setMessages((prev) =>
                prev.map((message) => message.id === optimisticId ? { ...message, id: data.message!.id! } : message)
              );
            }
          } catch (error) {
            console.error("[chat] Failed to persist channel message:", error);
          }
        }
        return;
      }
      setMainLoading(true);
      const startedProgress = {
        event: "run_started",
        at: new Date().toISOString(),
        elapsedMs: 0,
      };
      setExecutionProgress(startedProgress);
      setExecutionEvents([startedProgress]);
      setStreamingContent("");
      streamingContentRef.current = "";
      streamingAgentRef.current = respondingAgentCallsign;
      pageHiddenDuringRequestRef.current = false;
      firstDeltaSeenRef.current = false;
      lastBusyReplyAtRef.current = 0;
      hasStartedResponseAudioRef.current = false;
      const shouldSpeakResponses = options.forceVoiceResponse
        ? !agentAudioMuted
        : voiceMode === "agent"
          ? !agentAudioMuted
          : speakResponses;
      voiceLatencyRef.current = shouldSpeakResponses
        ? {
            requestId: createClientId(),
            startedAt: performance.now(),
          }
        : null;
      let fullContent = "";

      const chatMessages = [
        ...(shouldSpeakResponses
          ? [{ role: "system" as const, content: VOICE_SYSTEM_PROMPT }]
          : []),
        ...visibleMessages
          .filter((m) => !m.id.startsWith("queued-"))
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: messageContent },
      ];

      useActiveChatRunStore.getState().beginRun({ sessionKey: requestSessionKey });

      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeChatRunIdRef.current = null;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: chatMessages,
            agent: respondingAgent?.callsign,
            gatewayAgent: respondingDelegatedViaAgent?.callsign ?? respondingAgent?.callsign,
            targetAgent: respondingDelegatedViaAgent && respondingAgent
              ? {
                  callsign: respondingAgent.callsign,
                  name: respondingAgent.name,
                  title: respondingAgent.title,
                  runtimeRef: respondingAgent.runtimeRef,
                }
              : undefined,
            companyId: chatCompanyId,
            workspaceId: chatWorkspaceId,
            channelId: activeChannelId,
            metadata,
            sessionKey: requestSessionKey,
            agentMode: voiceMode === "agent",
            clientVisibility: typeof document !== "undefined" && document.hidden ? "hidden" : "visible",
            notifyOnCompletion: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        fullContent = "";
        // Track unspoken buffer for sentence-level TTS
        let unspokenBuffer = "";
        let sseBuffer = "";
        spokenSentencesRef.current = 0;
        ttsQueueRef.current = [];
        isSpeakingQueueRef.current = false;

        const handleSseData = (data: string) => {
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === "chat_progress" && typeof parsed.event === "string") {
              setExecutionProgress(parsed);
              setExecutionEvents((events) => {
                const nextEvents = [...events, parsed];
                persistExecutionSnapshot(parsed, nextEvents);
                return nextEvents;
              });
              useActiveChatRunStore.getState().applyProgressEvent(parsed);
              return;
            }

            if (parsed.type === "gateway_send_ack") {
              useActiveChatRunStore.getState().acknowledgeRun({
                sessionKey: parsed.sessionKey,
                runId: parsed.runId,
              });
              return;
            }

            // Handle meta events (message IDs from server-side persistence)
            if (parsed.type === "meta" && typeof parsed.chatRunId === "string") {
              activeChatRunIdRef.current = parsed.chatRunId;
              updateChatRunVisibility(parsed.chatRunId, document.hidden ? "hidden" : "visible");
              return;
            }

            if (parsed.type === "meta" && parsed.role === "user") {
              // Replace optimistic user message with server-confirmed one
              useChatStore.getState().replaceOptimisticMessage(requestSessionKey, optimisticId, {
                id: parsed.messageId,
                agentId: requestSessionKey,
                role: "user",
                content: userMsg.content,
                metadata,
                createdAt: userMsg.createdAt ?? new Date().toISOString(),
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === optimisticId
                    ? { ...m, id: parsed.messageId }
                    : m
                )
              );
              return;
            }

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (!firstDeltaSeenRef.current) {
                firstDeltaSeenRef.current = true;
                if (thinkingAckTimerRef.current) {
                  clearTimeout(thinkingAckTimerRef.current);
                  thinkingAckTimerRef.current = null;
                }
                if (voiceLatencyRef.current && !voiceLatencyRef.current.firstDeltaAt) {
                  voiceLatencyRef.current.firstDeltaAt = performance.now();
                }
              }
              fullContent += delta;
              streamingContentRef.current = fullContent;
              setStreamingContent(fullContent);

              // Sentence-level TTS: extract complete sentences and queue them
              if (shouldSpeakResponses) {
                unspokenBuffer += delta;
                const extracted = extractSpeakableSegments(unspokenBuffer);
                unspokenBuffer = extracted.remaining;
                for (const completeSentence of extracted.sentences) {
                  queueSentenceForTTS(completeSentence);
                  spokenSentencesRef.current++;
                }
              }
            }
          } catch {
            // Skip malformed JSON frames.
          }
        };

        const handleSseFrame = (frame: string) => {
          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6));
          if (dataLines.length === 0) return;
          handleSseData(dataLines.join("\n"));
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const frames = sseBuffer.split("\n\n");
          sseBuffer = frames.pop() ?? "";

          for (const frame of frames) {
            handleSseFrame(frame);
          }
        }
        if (sseBuffer.trim()) handleSseFrame(sseBuffer);

        // Queue any remaining unspoken text
        if (shouldSpeakResponses && unspokenBuffer.trim()) {
          queueSentenceForTTS(unspokenBuffer.trim());
        }

        if (fullContent.trim()) {
          // Parse task references and inject inline card markers
          const enrichedContent = injectTaskCardMarkers(fullContent, parseTaskReferences(fullContent));
          const assistantId = createClientId();
          const assistantMsg: Message = {
            id: assistantId,
            role: "assistant",
            content: enrichedContent,
            createdAt: new Date().toISOString(),
          };
          useChatStore.getState().addMessage({
            id: assistantId,
            agentId: requestSessionKey,
            role: "assistant",
            content: enrichedContent,
            createdAt: assistantMsg.createdAt ?? new Date().toISOString(),
          });
          setMessages((prev) => [...prev, assistantMsg]);
        }
        // Assistant message persisted server-side in /api/chat route
        streamingContentRef.current = "";
        streamingAgentRef.current = null;
        setStreamingContent("");
        const completedProgress = {
          event: "run_completed",
          at: new Date().toISOString(),
        };
        setExecutionProgress((current) =>
          current?.event === "run_error" || current?.event === "run_aborted"
            ? current
            : completedProgress
        );
        setExecutionEvents((events) => {
          const last = events.at(-1);
          if (last?.event === "run_error" || last?.event === "run_aborted") return events;
          return [...events, completedProgress];
        });
        useActiveChatRunStore.getState().applyProgressEvent({
          type: "chat_progress",
          event: "run_completed",
          sessionKey: requestSessionKey,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          useActiveChatRunStore.getState().applyProgressEvent({
            type: "chat_progress",
            event: "run_aborted",
            sessionKey: requestSessionKey,
          });
          // User cancelled with Escape — keep any partial content as the message
          if (fullContent) {
            const cancelledContent = fullContent + "\n\n_(cancelled)_";
            setMessages((prev) => [
              ...prev,
              {
                id: createClientId(),
                role: "assistant",
                content: cancelledContent,
              },
            ]);
            // Partial content persisted server-side via cancel handler
          }
          streamingContentRef.current = "";
          streamingAgentRef.current = null;
          setStreamingContent("");
          const abortedProgress = {
            event: "run_aborted",
            at: new Date().toISOString(),
          };
          setExecutionProgress(abortedProgress);
          setExecutionEvents((events) => [...events, abortedProgress]);
        } else {
          const wasBackgrounded = pageHiddenDuringRequestRef.current ||
            (typeof document !== "undefined" && document.hidden);
          console.error("[Chat] Error:", error);
          const errorProgress = {
            event: wasBackgrounded ? "connection_interrupted" : "run_error",
            at: new Date().toISOString(),
            error: wasBackgrounded
              ? "Connection interrupted while CrewCMD was in the background."
              : error instanceof Error ? error.message : "Connection error.",
          };
          useActiveChatRunStore.getState().applyProgressEvent({
            type: "chat_progress",
            event: errorProgress.event,
            sessionKey: requestSessionKey,
          });
          setExecutionProgress(errorProgress);
          setExecutionEvents((events) => [...events, errorProgress]);
          if (!wasBackgrounded && fullContent.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                id: createClientId(),
                role: "assistant",
                content: `${fullContent}\n\n_(connection interrupted)_`,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          if (wasBackgrounded) {
            void refreshSessionPreview(requestSessionKey).then((loaded) => {
              if (!loaded) return;
              pageHiddenDuringRequestRef.current = false;
              const completedProgress = {
                event: "run_completed",
                at: new Date().toISOString(),
              };
              setExecutionProgress(completedProgress);
              setExecutionEvents((events) => [...events, completedProgress]);
              useActiveChatRunStore.getState().applyProgressEvent({
                type: "chat_progress",
                event: "run_completed",
                at: completedProgress.at,
                sessionKey: requestSessionKey,
              });
            });
          }
          streamingContentRef.current = "";
          streamingAgentRef.current = null;
          setStreamingContent("");
        }
      }

      abortControllerRef.current = null;
      activeChatRunIdRef.current = null;
      setMainLoading(false);
      const nextQueued = queuedMainMessagesRef.current.shift();
      if (nextQueued) {
        window.setTimeout(() => {
          void sendMessage(nextQueued.text, {
            ...nextQueued.options,
            fromQueue: true,
            queuedMessageId: nextQueued.id,
            files: nextQueued.files,
          });
        }, 0);
      }
    },
    [visibleMessages, queueSentenceForTTS, selectedAgent, speakResponses, agentAudioMuted, pendingFiles, agents, eligibleChannelAgents, isPaused, stopWords, activeChannelId, chatCompanyId, chatWorkspaceId, selectedSessionKey, defaultAgent, delegatedViaAgent, persistExecutionSnapshot, refreshSessionPreview, enqueueMainMessage, setMainLoading, agentCallsign, voiceMode]
  );

  const sendThreadMessage = useCallback(async (
    overrideContent?: string,
    options: { fromQueue?: boolean; queuedMessageId?: string; thread?: ActiveThread; files?: File[] } = {}
  ) => {
    const thread = options.thread ?? activeThread;
    const trimmed = (overrideContent ?? threadInput).trim();
    const filesForMessage = options.files ?? threadPendingFiles;
    const hasFiles = filesForMessage.length > 0;
    if (!thread || (!trimmed && !hasFiles)) return;

    if (isThreadLoadingRef.current && !options.fromQueue) {
      enqueueThreadMessage(thread, trimmed, filesForMessage);
      return;
    }

    let attachments: Attachment[] = [];
    const filesToUpload = [...filesForMessage];
    if (!options.fromQueue) setThreadPendingFiles([]);

    if (filesToUpload.length > 0) {
      try {
        attachments = await Promise.all(filesToUpload.map(uploadFile));
      } catch (err) {
        console.error("[chat] Thread file upload failed:", err);
        if (!options.fromQueue) setThreadPendingFiles(filesToUpload);
        return;
      }
    }

    let messageContent = trimmed;
    if (attachments.length > 0) {
      const refs = attachments.map((a) =>
        a.mimeType.startsWith("image/")
          ? `![${a.filename}](${a.url})`
          : `[${a.filename}](${a.url})`
      ).join("\n");
      messageContent = messageContent ? `${messageContent}\n\n${refs}` : refs;
    }

    const metadata = attachments.length > 0 ? { attachments } : null;

    const optimisticId = `optimistic-${createClientId()}`;
    const userMsg: Message = {
      id: optimisticId,
      role: "user",
      content: trimmed || "(attachments)",
      createdAt: new Date().toISOString(),
      metadata,
    };
    useChatStore.getState().addMessage({
      id: optimisticId,
      agentId: thread.sessionKey.toLowerCase(),
      role: "user",
      content: userMsg.content,
      metadata,
      createdAt: userMsg.createdAt ?? new Date().toISOString(),
    });
    setThreadMessages((prev) => {
      if (prev.some((message) => message.id === optimisticId)) return prev;
      return options.queuedMessageId
        ? prev.map((message) => message.id === options.queuedMessageId ? { ...userMsg } : message)
        : [...prev, userMsg];
    });
    setThreadInput("");
    setThreadLoading(true);
    setThreadStreamingContent("");
    const startedProgress = {
      event: "run_started",
      at: new Date().toISOString(),
      elapsedMs: 0,
    };
    setThreadProgress(startedProgress);
    setThreadEvents([startedProgress]);
    const shouldSpeakThreadResponses = !agentAudioMuted && (
      speakResponses ||
      (voiceMode === "agent" && agentModeSessionKey === thread.sessionKey)
    );
    if (shouldSpeakThreadResponses) {
      spokenSentencesRef.current = 0;
      ttsQueueRef.current = [];
      isSpeakingQueueRef.current = false;
    }

    let fullContent = "";
    let assistantMessageId: string | null = null;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...thread.contextMessages.map((message) => ({ role: message.role, content: message.content })),
            ...threadMessages
              .filter((message) => !message.id.startsWith("queued-"))
              .map((message) => ({ role: message.role, content: message.content })),
            { role: "user", content: messageContent },
          ],
          agent: selectedAgent?.callsign,
          gatewayAgent: delegatedViaAgent?.callsign ?? selectedAgent?.callsign,
          targetAgent: delegatedViaAgent && selectedAgent
            ? {
                callsign: selectedAgent.callsign,
                name: selectedAgent.name,
                title: selectedAgent.title,
                runtimeRef: selectedAgent.runtimeRef,
              }
            : undefined,
          companyId: chatCompanyId,
          workspaceId: chatWorkspaceId,
          metadata,
          sessionKey: thread.sessionKey,
          clientVisibility: typeof document !== "undefined" && document.hidden ? "hidden" : "visible",
          notifyOnCompletion: true,
          threadContext: {
            parentSessionKey: thread.parentSessionKey,
            threadSessionKey: thread.sessionKey,
            parentMessage: {
              role: thread.parentMessage.role,
              content: thread.parentMessage.content,
              id: threadParentIdForMessage(thread.parentMessage),
              createdAt: thread.parentMessage.createdAt,
            },
            contextMessages: thread.contextMessages.map((message) => ({
              role: message.role,
              content: message.content,
              id: threadParentIdForMessage(message),
              createdAt: message.createdAt,
            })),
          },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let sseBuffer = "";
      let unspokenBuffer = "";
      const handleSseData = (data: string) => {
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "chat_progress" && typeof parsed.event === "string") {
            setThreadProgress(parsed);
            setThreadEvents((events) => [...events, parsed].slice(-40));
            useActiveChatRunStore.getState().applyProgressEvent(parsed);
            return;
          }
          if (parsed.type === "meta" && parsed.role === "user") {
            setThreadMessages((prev) =>
              prev.map((message) => message.id === optimisticId ? { ...message, id: parsed.messageId } : message)
            );
            if (typeof parsed.messageId === "string") {
              useChatStore.getState().replaceMessageId(thread.sessionKey, optimisticId, parsed.messageId);
            }
            return;
          }
          if (parsed.type === "meta" && parsed.role === "assistant") {
            if (typeof parsed.messageId === "string") {
              assistantMessageId = parsed.messageId;
              if (fullContent.trim()) {
                useChatStore.getState().addMessage({
                  id: parsed.messageId,
                  agentId: thread.sessionKey.toLowerCase(),
                  role: "assistant",
                  content: injectTaskCardMarkers(fullContent, parseTaskReferences(fullContent)),
                  createdAt: new Date().toISOString(),
                });
              }
            }
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            setThreadStreamingContent(fullContent);
            if (shouldSpeakThreadResponses) {
              unspokenBuffer += delta;
              const extracted = extractSpeakableSegments(unspokenBuffer);
              unspokenBuffer = extracted.remaining;
              for (const completeSentence of extracted.sentences) {
                queueSentenceForTTS(completeSentence);
                spokenSentencesRef.current++;
              }
            }
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      const handleSseFrame = (frame: string) => {
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));
        if (dataLines.length > 0) handleSseData(dataLines.join("\n"));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const frames = sseBuffer.split("\n\n");
        sseBuffer = frames.pop() ?? "";
        for (const frame of frames) handleSseFrame(frame);
      }
      if (sseBuffer.trim()) handleSseFrame(sseBuffer);

      if (shouldSpeakThreadResponses && unspokenBuffer.trim()) {
        queueSentenceForTTS(unspokenBuffer.trim());
      }

      if (fullContent.trim()) {
        const enrichedContent = injectTaskCardMarkers(fullContent, parseTaskReferences(fullContent));
        const visibleAssistantId = assistantMessageId ?? createClientId();
        if (!assistantMessageId) {
          useChatStore.getState().addMessage({
            id: visibleAssistantId,
            agentId: thread.sessionKey.toLowerCase(),
            role: "assistant",
            content: enrichedContent,
            createdAt: new Date().toISOString(),
          });
        }
        setThreadMessages((prev) => {
          if (prev.some((message) => message.id === visibleAssistantId)) return prev;
          return [
            ...prev,
            {
              id: visibleAssistantId,
              role: "assistant",
              content: enrichedContent,
              createdAt: new Date().toISOString(),
            },
          ];
        });
      }
      setThreadStreamingContent("");
      const completedProgress = {
        event: "run_completed",
        at: new Date().toISOString(),
      };
      setThreadProgress(completedProgress);
      setThreadEvents((events) => [...events, completedProgress].slice(-40));
    } catch (error) {
      const errorProgress = {
        event: "run_error",
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Connection error.",
      };
      setThreadProgress(errorProgress);
      setThreadEvents((events) => [...events, errorProgress].slice(-40));
      if (fullContent.trim()) {
        setThreadMessages((prev) => [
          ...prev,
          {
            id: createClientId(),
            role: "assistant",
            content: `${fullContent}\n\n_(connection interrupted)_`,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setThreadStreamingContent("");
    } finally {
      void loadCrewCmdSessionHistoryByKey(thread.sessionKey, chatCompanyId, chatWorkspaceId);
      setThreadLoading(false);
      const nextQueued = queuedThreadMessagesRef.current.shift();
      if (nextQueued) {
        window.setTimeout(() => {
          void sendThreadMessage(nextQueued.text, {
            fromQueue: true,
            queuedMessageId: nextQueued.id,
            thread: nextQueued.thread,
            files: nextQueued.files,
          });
        }, 0);
      }
    }
  }, [activeThread, agentAudioMuted, agentModeSessionKey, chatCompanyId, chatWorkspaceId, delegatedViaAgent, enqueueThreadMessage, queueSentenceForTTS, selectedAgent, setThreadLoading, speakResponses, threadInput, threadMessages, threadPendingFiles, voiceMode]);

  const interruptAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingAudio(false);
    }
  }, []);

  const stopActiveRun = useCallback(() => {
    const runId = activeChatRunIdRef.current;
    const abortLocalStream = () => abortControllerRef.current?.abort();
    if (!runId) {
      abortLocalStream();
      return;
    }

    fetch(`/api/chat/runs/${encodeURIComponent(runId)}/abort`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // Local abort still stops the visible stream even if the server abort request fails.
    }).finally(abortLocalStream);
  }, []);

  const handleAgentAudioMutedChange = useCallback(
    (muted: boolean) => {
      if (muted) stopAllAudio();
      setAgentAudioMuted(muted);
    },
    [stopAllAudio]
  );

  const togglePin = useCallback(async (message: Message) => {
    if (!isUuid(message.id)) return;
    if (!chatCompanyId && !chatWorkspaceId) return;
    const isPinned = pins.some((pin) => pin.messageId === message.id);
    try {
      if (isPinned) {
        await fetch(`/api/chat/pins?messageId=${encodeURIComponent(message.id)}`, { method: "DELETE" });
        setPins((prev) => prev.filter((pin) => pin.messageId !== message.id));
        return;
      }

      const res = await fetch("/api/chat/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: message.id,
          companyId: chatCompanyId,
          workspaceId: chatWorkspaceId,
        }),
      });
      if (res.ok) {
        await loadPins();
      }
    } catch {
      // Leave the current pin state unchanged when persistence fails.
    }
  }, [chatCompanyId, chatWorkspaceId, loadPins, pins]);

  const buildChatMessageUrl = useCallback((params: {
    agentId?: string | null;
    sessionKey?: string | null;
    messageId: string;
  }) => {
    const query = new URLSearchParams();
    const agent = params.agentId || selectedAgent?.callsign || null;
    const sessionKey = params.sessionKey || activeSessionKey;
    if (agent) query.set("agent", agent.toLowerCase());
    if (sessionKey) query.set("sessionKey", sessionKey);
    query.set("messageId", params.messageId);
    return `/chat?${query.toString()}`;
  }, [activeSessionKey, selectedAgent?.callsign]);

  const navigateToMessage = useCallback((params: {
    agentId?: string | null;
    sessionKey?: string | null;
    messageId: string;
  }) => {
    pendingMessageScrollRef.current = params.messageId;
    const agent = params.agentId || selectedAgent?.callsign || null;
    const sessionKey = params.sessionKey || activeSessionKey;
    setUrlAgentCallsign(agent?.toLowerCase() ?? null);
    setUrlSessionKey(sessionKey);
    setUrlMessageId(params.messageId);
    if (visibleMessages.some((message) => message.id === params.messageId)) {
      scrollToMessage(params.messageId);
    }
    router.push(buildChatMessageUrl(params));
  }, [buildChatMessageUrl, router, scrollToMessage, visibleMessages]);

  const toggleSaved = useCallback(async (message: Message) => {
    if (!isUuid(message.id)) return;
    if (!chatCompanyId && !chatWorkspaceId) return;
    const existing = savedByMessageId[message.id];
    try {
      if (existing) {
        const res = await fetch(`/api/saved-items/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
        if (res.ok) {
          setSavedByMessageId((prev) => {
            const next = { ...prev };
            delete next[message.id];
            return next;
          });
        }
        return;
      }

      const res = await fetch("/api/saved-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: chatCompanyId,
          workspaceId: chatWorkspaceId,
          sourceType: "chat_message",
          sourceId: message.id,
          status: "in_progress",
          title: messagePreview(message.content, 80),
          metadata: {
            agentCallsign: selectedAgent?.callsign ?? null,
            sessionKey: activeSessionKey,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { item?: SavedItem };
        if (data.item) {
          setSavedByMessageId((prev) => ({ ...prev, [message.id]: data.item! }));
        }
      }
    } catch {
      // Leave the current saved state unchanged when persistence fails.
    }
  }, [activeSessionKey, chatCompanyId, chatWorkspaceId, savedByMessageId, selectedAgent?.callsign]);

  const clearChat = async () => {
    setMessages([]);
    setPins([]);
    setSavedByMessageId({});
    setExecutionProgress(null);
    setExecutionEvents([]);
    storeClearAgent(activeSessionKey);
    loadedAgentsRef.current.add(`${chatScopeKey}:${activeSessionKey.toLowerCase()}`);
    if (selectedSessionKey) {
      loadedAgentsRef.current.add(`${chatScopeKey}:${selectedSessionKey.toLowerCase()}`);
    }

    if (!chatCompanyId && !chatWorkspaceId) return;

    try {
      await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agentCallsign,
          companyId: chatCompanyId,
          workspaceId: chatWorkspaceId,
          channelId: activeChannelId,
          gatewaySessionKey: selectedSessionKey ?? undefined,
        }),
      });
    } catch {
      // Local clear still succeeds; persistence will retry on next explicit clear.
    }
  };

  const pinnedMessageIds = new Set(pins.map((pin) => pin.messageId));
  const visiblePins = pins.slice(0, 3);
  const activeConversationLabel = activeChannel ? `# ${activeChannel.name ?? "untitled"}` : agentCallsign;
  const eligibleChannelAgentCallsigns = eligibleChannelAgents.map((agent) => `@${agent.callsign}`);
  const channelAgentHint = eligibleChannelAgentCallsigns.length > 0
    ? `mention ${eligibleChannelAgentCallsigns.slice(0, 2).join(" or ")} to invite an agent`
    : "no shared agents in this channel";
  const composerPlaceholder = isPaused
    ? `Say "${agentCallsign}" or @${agentCallsign} to resume...`
    : activeChannel
      ? `Message #${activeChannel.name ?? "channel"}...`
      : `Message ${agentCallsign}...`;

  return (
    <div className="flex h-[calc(100dvh_-_var(--mobile-app-bar-height))] overflow-hidden lg:h-dvh flex-col">
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} className="hidden" />

      {/* Header */}
      <div className="sticky top-0 z-40 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-3 py-2.5 shadow-[0_10px_28px_rgba(2,6,23,0.08)] backdrop-blur-xl sm:px-4 sm:py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div
              className={`h-2.5 w-2.5 rounded-full transition-opacity ${isPaused ? "opacity-30" : ""}`}
              style={{
                backgroundColor: isPaused ? "var(--text-tertiary)" : agentIdentityColor,
              }}
            />

            {/* Paused badge */}
            {isPaused && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium tracking-wider text-amber-400">
                PAUSED
              </span>
            )}

            {activeChannel ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 min-w-0 items-center rounded-[var(--radius-control)] border border-[var(--border-medium)] bg-[var(--control-bg)] px-3 text-sm font-semibold text-[var(--text-primary)]">
                  <span className="truncate"># {activeChannel.name ?? "untitled"}</span>
                </div>
                <div className="hidden min-w-0 flex-col sm:flex">
                  <span className="truncate text-[11px] font-medium text-[var(--text-secondary)]">
                    {activeChannel.description || "Channel conversation"}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {activeChannelMembers.length} member{activeChannelMembers.length === 1 ? "" : "s"}
                    {` · ${channelAgentHint}`}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <AgentTreeSelector
                  agents={agents}
                  selectedAgent={selectedAgent}
                  onSelect={handleAgentSelect}
                  unreadCounts={unreadCounts}
                />

                {selectedAgent && (
                  <div className="hidden flex-col sm:flex">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {selectedAgent.title || selectedAgent.name}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {delegatedViaAgent ? (
                        <>
                          Via: {delegatedViaAgent.emoji} {delegatedViaAgent.callsign}
                        </>
                      ) : parentAgent ? (
                        <>
                          Reports to: {parentAgent.emoji} {parentAgent.callsign}
                        </>
                      ) : (
                        "Direct message"
                      )}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CompanySwitcher compact className="w-36 sm:w-40 lg:hidden" />

            {/* Clear chat */}
            <button
              onClick={clearChat}
              className="hidden sm:block rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all hover:border-[var(--border-medium)] hover:text-[var(--text-tertiary)]"
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>

      {visiblePins.length > 0 && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-3 py-2 backdrop-blur-xl sm:px-4 lg:px-6">
          <div className="mx-auto flex max-w-3xl gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">Pin</span>
            <div className="grid min-w-0 flex-1 gap-1">
              {visiblePins.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => navigateToMessage({
                    agentId: pin.agentId,
                    sessionKey: pin.gatewaySessionKey ?? activeSessionKey,
                    messageId: pin.messageId,
                  })}
                  className="min-w-0 rounded-md px-2 py-1 text-left transition hover:bg-[var(--bg-surface-hover)]"
                >
                  <span className="mr-2 font-semibold text-[var(--text-primary)]">{pin.role === "user" ? "You" : selectedAgent?.callsign ?? "AI"}</span>
                  <span className="text-[var(--text-tertiary)]">{messagePreview(pin.content)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeThread && (
        <ChatThreadDrawer
          activeThread={activeThread}
          agentCallsign={selectedAgent?.callsign ?? "Agent"}
          agentDisplayName={assistantDisplayName}
          agentAvatarUrl={assistantAvatarUrl}
          agentEmoji={agentEmoji}
          userDisplayName={userDisplayName}
          userAvatarUrl={userAvatarUrl}
          messages={visibleThreadMessages}
          streamingContent={threadStreamingContent}
          isLoading={isThreadLoading}
          progress={threadProgress}
          events={threadEvents}
          agentColor={agentColor}
          voiceSettings={resolvedVoiceSettings}
          visualViewport={visualViewport}
          scrollContainerRef={threadScrollContainerRef}
          onClose={closeThread}
          composer={(
            <>
              {voiceMode === "agent" && agentModeSessionKey === activeThread.sessionKey ? (
                <div className="mb-2 rounded-[22px] border border-[var(--voice-shell-border)] bg-[var(--bg-surface)]/88 px-3 py-2 shadow-[var(--theme-shadow)] backdrop-blur-xl">
                  <VoiceAgent
                    onTranscript={(text) => void sendThreadMessage(text)}
                    isPlayingAudio={isPlayingAudio}
                    onInterrupt={interruptAudio}
                    isLoading={isThreadLoading}
                    accentColor={agentColor}
                    autoActivate
                    compact
                    isMicMuted={agentMicMuted}
                    isAgentMuted={agentAudioMuted}
                    onMicMutedChange={setAgentMicMuted}
                    onAgentMutedChange={handleAgentAudioMutedChange}
                    agent={selectedAgent?.callsign}
                    gatewayAgent={delegatedViaAgent?.callsign ?? selectedAgent?.callsign}
                    companyId={company?.id}
                    sessionKey={activeThread.sessionKey}
                  />
                </div>
              ) : null}
              <ChatComposer
                value={threadInput}
                onValueChange={setThreadInput}
                placeholder="Reply in thread..."
                pendingFiles={threadPendingFiles}
                onAddFiles={addThreadFiles}
                onRemoveFile={removeThreadFile}
                onSend={(text) => void sendThreadMessage(text)}
                onTranscript={(text) => void sendThreadMessage(text)}
                onFocus={() => window.requestAnimationFrame(() => scrollThreadToBottom("smooth"))}
                isLoading={isThreadLoading}
                speakResponses={speakResponses}
                onToggleSpeak={() => {
                  if (speakResponses) stopAllAudio();
                  setSpeakResponses(!speakResponses);
                }}
                onEnterAgentMode={() => {
                  if (voiceMode === "agent" && agentModeSessionKey === activeThread.sessionKey) {
                    stopAllAudio();
                    setVoiceMode("off");
                    setAgentModeSessionKey(null);
                    setAgentMicMuted(false);
                    setAgentAudioMuted(false);
                    return;
                  }
                  if (!isNativeCapacitorApp() && audioRef.current) {
                    audioRef.current.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
                    audioRef.current.play().catch(() => {});
                  }
                  setAgentMicMuted(false);
                  setAgentAudioMuted(false);
                  setAgentOverlayMode("transcript");
                  setAgentModeSessionKey(activeThread.sessionKey);
                  setVoiceMode("agent");
                  setSpeakResponses(true);
                }}
                agentButtonTitle={voiceMode === "agent" && agentModeSessionKey === activeThread.sessionKey ? "Exit thread agent mode" : "Enter thread agent mode"}
              />
            </>
          )}
        />
      )}

      {activeIdentityProfile && (
        <ChatIdentityProfilePanel
          profile={activeIdentityProfile}
          onClose={() => setActiveIdentityProfile(null)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Channel sidebar */}
        <aside className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 backdrop-blur-xl lg:h-full lg:w-64 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4 lg:px-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Channels</span>
              <button
                type="button"
                onClick={() => setChannelPanelOpen((open) => !open)}
                className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
              >
                {channelPanelOpen ? "Done" : "Manage"}
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => selectChannel(channel.id)}
                  className={`flex shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition lg:w-full ${activeChannelId === channel.id ? "border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"}`}
                  title={channel.description ?? undefined}
                >
                  <span className="min-w-0 truncate"># {channel.name ?? "untitled"}</span>
                  {activeChannelId === channel.id ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => selectChannel(null)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left text-[12px] transition lg:w-full ${!activeChannelId ? "border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"}`}
              >
                Direct messages
              </button>
            </div>

            {activeChannel ? (
              <div className="hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/55 p-3 text-[11px] text-[var(--text-tertiary)] lg:block">
                <div className="font-medium text-[var(--text-secondary)]">#{activeChannel.name}</div>
                <div className="mt-1 leading-relaxed">{activeChannel.description || "No purpose set yet."}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 uppercase tracking-wide">{activeChannel.visibility}</span>
                  <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5">{activeChannelMembers.length} member{activeChannelMembers.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            ) : (
              <div className="hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/55 p-3 text-[11px] text-[var(--text-tertiary)] lg:block">
                Direct mode is separate from channel-scoped sessions, messages, pins, and threads.
              </div>
            )}

            {channelPanelOpen && (
              <div className="grid gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 p-3">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Create channel</div>
                  <input
                    value={newChannelName}
                    onChange={(event) => setNewChannelName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void createChannel(); }}
                    placeholder="Channel name"
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                  <input
                    value={newChannelPurpose}
                    onChange={(event) => setNewChannelPurpose(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void createChannel(); }}
                    placeholder="Purpose / topic"
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => void createChannel()}
                    disabled={!newChannelName.trim()}
                    className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/12 px-3 py-2 text-[11px] font-semibold text-[var(--text-primary)] transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Members</div>
                  {activeChannel ? (
                    <>
                      <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                        {activeChannelMembers.length === 0 ? (
                          <div className="text-[11px] text-[var(--text-tertiary)]">No visible members.</div>
                        ) : activeChannelMembers.map((member) => (
                          <div key={member.id ?? `${member.memberType}:${member.userId ?? member.agentId}`} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-[var(--text-secondary)]">
                              {member.memberType === "agent" && member.agentId
                                ? `@${channelAgentById.get(member.agentId)?.callsign ?? member.agentId}`
                                : member.name || member.email || member.userId || "Unknown"}
                            </span>
                            <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[var(--text-tertiary)]">
                              {member.memberType === "agent" ? member.agentParticipationMode ?? "mention_only" : member.role}
                            </span>
                          </div>
                        ))}
                      </div>
                      {activeChannel.canManage ? (
                        <div className="flex gap-2">
                          <input
                            value={memberUserId}
                            onChange={(event) => setMemberUserId(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") void addChannelMember(); }}
                            placeholder="User ID to add"
                            className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                          <button
                            type="button"
                            onClick={() => void addChannelMember()}
                            disabled={!memberUserId.trim()}
                            className="rounded-lg border border-[var(--border-medium)] px-3 py-2 text-[11px] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--text-tertiary)]">Only channel admins can manage membership.</div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] text-[var(--text-tertiary)]">Select a channel to see members and admin controls.</div>
                  )}
                </div>
                {channelNotice && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">{channelNotice}</div>}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
      {/* Messages area */}
      <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {transcriptItems.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--border-medium)] bg-[var(--bg-surface)]"
                style={{
                  boxShadow: "var(--theme-shadow)",
                }}
              >
                <span className="text-xl">{activeChannel ? "#" : agentEmoji}</span>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
                {activeConversationLabel}
              </h2>
              <p className="max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {activeChannel
                  ? activeChannel.description || "Start a channel conversation with the crew."
                  : `Start a direct conversation with ${selectedAgent?.name || agentCallsign} via the OpenClaw Gateway.${
                    delegatedViaAgent
                      ? ` CrewCmd will route this through ${delegatedViaAgent.callsign}.`
                      : ""
                  }${
                    parentAgent
                      ? ` This is ${agentCallsign}'s thread — ${parentAgent.emoji} ${parentAgent.callsign} monitors it.`
                      : ""
                  }`}
              </p>

            </div>
          )}

          {transcriptItems.map((msg, i) => {
            const prevDate = i > 0 ? getDateKey(transcriptItems[i - 1].createdAt) : null;
            const currDate = getDateKey(msg.createdAt);
            const showSeparator = currDate && currDate !== prevDate;
            const threadSummary = threadReplySummaries[`id:${threadParentIdForMessage(msg)}`];
            const threadReplies = threadSummary?.replies ?? [];
            const canPersistMessageAction = isUuid(msg.id);
            const isHeartbeatAck = isHeartbeatAckMessage(msg);
            return (
              <div
                key={msg.id}
                id={`chat-message-${msg.id}`}
                className={`scroll-mt-24 rounded-2xl transition-shadow duration-500 ${
                  highlightedMessageId === msg.id ? "shadow-[0_0_0_2px_var(--accent)]" : ""
                }`}
              >
                {showSeparator && <DateSeparator date={msg.createdAt!} />}
                {isHeartbeatAck ? (
                  <HeartbeatAckMarker timestamp={msg.createdAt} />
                ) : (
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.createdAt}
                    metadata={msg.metadata}
                    authorName={msg.role === "user" ? userDisplayName : assistantDisplayName}
                    authorAvatarUrl={msg.role === "user" ? userAvatarUrl : assistantAvatarUrl}
                    authorEmoji={msg.role === "assistant" ? agentEmoji : null}
                    identityDetails={msg.role === "user" ? userIdentityDetails : assistantIdentityDetails}
                    onOpenIdentity={setActiveIdentityProfile}
                    onReplyInThread={() => openThreadForMessage(msg, i, threadSummary?.sessionKey)}
                    onTogglePin={canPersistMessageAction ? () => void togglePin(msg) : undefined}
                    onToggleSaved={canPersistMessageAction ? () => void toggleSaved(msg) : undefined}
                    isPinned={pinnedMessageIds.has(msg.id)}
                    isSaved={Boolean(savedByMessageId[msg.id])}
                    threadReplyCount={threadReplies.length}
                    threadReplies={threadReplies}
                    voiceSettings={resolvedVoiceSettings}
                  />
                )}
              </div>
            );
          })}

          {/* Execution progress */}
          {(isLoading || executionProgress || hasPersistedExecutionActivity) && (
            <ExecutionProgressPanel
              progress={executionProgress}
              events={executionEvents}
              isLoading={isLoading}
              hasStreamingContent={Boolean(streamingContent)}
              agentColor={agentColor}
            />
          )}

          {/* Streaming message */}
          {streamingContent && (
            <div>
              <ChatMessage
                role="assistant"
                content={streamingContent}
                isStreaming={true}
                authorName={assistantDisplayName}
                authorAvatarUrl={assistantAvatarUrl}
                authorEmoji={agentEmoji}
                identityDetails={assistantIdentityDetails}
                onOpenIdentity={setActiveIdentityProfile}
                voiceSettings={resolvedVoiceSettings}
              />
              <button
                onClick={stopActiveRun}
                className="ml-11 mt-1 flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-secondary)]"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
                Stop
              </button>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && !executionProgress && (
            <div className="flex gap-3 animate-fade-in">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-medium)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-secondary)]"
              >
                {agentAbbrev}
              </div>
              <div
                className="flex items-center gap-1.5 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
              >
                <span className="h-2 w-2 rounded-full animate-pulse bg-[var(--accent)]/70" />
                <span className="h-2 w-2 rounded-full animate-pulse bg-[var(--accent)]/70 [animation-delay:0.15s]" />
                <span className="h-2 w-2 rounded-full animate-pulse bg-[var(--accent)]/70 [animation-delay:0.3s]" />
              </div>
              <span className="ml-2 self-center text-[11px] text-[var(--text-tertiary)] opacity-60">
                Esc to cancel
              </span>
            </div>
          )}

          {/* Waveform when playing audio */}
          {isPlayingAudio && (
            <div className="flex justify-center py-2">
              <WaveformVisualizer isActive={isPlayingAudio} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom floating button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)]/90 backdrop-blur-sm px-4 py-2 text-xs text-[var(--text-secondary)] shadow-lg transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)] animate-fade-in"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
            </svg>
            Scroll to bottom
          </button>
        )}
      </div>

      {/* Voice surface: inline by default, immersive only when expanded. */}
      {voiceMode === "agent" && !activeThread && (
        <div
          className={
            agentOverlayMode === "immersive"
              ? "fixed inset-0 z-[90] overflow-hidden"
              : "shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/80 px-3 pt-2 backdrop-blur-xl sm:px-4"
          }
          style={{
            color: "var(--text-primary)",
            background:
              agentOverlayMode === "immersive"
                ? "linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 97%, transparent), color-mix(in srgb, var(--bg-primary) 93%, var(--bg-secondary) 7%))"
                : undefined,
          }}
        >
          {agentOverlayMode === "immersive" ? (
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage: [
                  "linear-gradient(var(--voice-overlay-grid) 1px, transparent 1px)",
                  "linear-gradient(90deg, var(--voice-overlay-grid-soft) 1px, transparent 1px)",
                ].join(", "),
                backgroundSize: "44px 44px",
              }}
            />
          ) : null}
          <div className={agentOverlayMode === "immersive" ? "relative flex h-full flex-col justify-center" : "relative"}>
            {agentOverlayMode === "immersive" ? (
              <div className="absolute right-4 top-[max(var(--mobile-safe-top),1rem)] z-10 flex gap-2 sm:right-6">
                <button
                  onClick={() => setVoicePickerOpen(true)}
                  title="Choose voice"
                  aria-label="Choose voice"
                  className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-[var(--theme-shadow)] transition ${sessionVoiceOverride ? "border-[#00f0ff]/45 bg-[#00f0ff]/15 text-[#00f0ff]" : "border-[var(--border-medium)] bg-[var(--bg-surface)]/85 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"}`}
                >
                  <VoicePersonIcon />
                </button>
                <button
                  onClick={() => setAgentOverlayMode("transcript")}
                  title="Return to chat"
                  aria-label="Return to chat"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)]/85 text-[var(--text-secondary)] shadow-[var(--theme-shadow)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5H5.25A.75.75 0 0 0 4.5 5.25V9m10.5-4.5h3.75a.75.75 0 0 1 .75.75V9M9 19.5H5.25a.75.75 0 0 1-.75-.75V15m10.5 4.5h3.75a.75.75 0 0 0 .75-.75V15M8.25 8.25l-3.75-3.75m15 0-3.75 3.75m-7.5 7.5-3.75 3.75m15 0-3.75-3.75" />
                  </svg>
                </button>
              </div>
            ) : null}

            <div
              className={
                agentOverlayMode === "immersive"
                  ? "flex flex-1 items-center px-4 pb-3 sm:px-6"
                  : ""
              }
            >
              <div className={agentOverlayMode === "immersive" ? "mx-auto w-full max-w-none px-0 py-0" : "mx-auto max-w-3xl"}>
                <div
                  className={
                    agentOverlayMode === "immersive"
                      ? "flex flex-col items-center gap-2"
                      : "relative mb-2 rounded-[22px] border border-[var(--voice-shell-border)] bg-[var(--bg-surface)]/88 px-3 py-2 shadow-[var(--theme-shadow)] backdrop-blur-xl"
                  }
                >
                  <VoiceAgent
                    onTranscript={(text) => sendMessage(text, { forceVoiceResponse: true })}
                    isPlayingAudio={isPlayingAudio}
                    onInterrupt={interruptAudio}
                    isLoading={isLoading}
                    accentColor={agentColor}
                    autoActivate
                    immersive={agentOverlayMode === "immersive"}
                    compact={agentOverlayMode === "transcript"}
                    isMicMuted={agentMicMuted}
                    isAgentMuted={agentAudioMuted}
                    onMicMutedChange={setAgentMicMuted}
                    onAgentMutedChange={handleAgentAudioMutedChange}
                    agent={selectedAgent?.callsign}
                    gatewayAgent={delegatedViaAgent?.callsign ?? selectedAgent?.callsign}
                    companyId={company?.id}
                    sessionKey={selectedSessionBelongsToAgent(selectedSessionKey, selectedAgent?.callsign)
                      ? selectedSessionKey ?? gatewaySessionKeyForAgent(selectedAgent)
                      : gatewaySessionKeyForAgent(selectedAgent)}
                  />
                  {agentOverlayMode === "transcript" ? (
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <button
                        onClick={() => setVoicePickerOpen(true)}
                        title="Choose voice"
                        aria-label="Choose voice"
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${sessionVoiceOverride ? "border-[#00f0ff]/45 bg-[#00f0ff]/15 text-[#00f0ff]" : "border-[var(--border-medium)] bg-[var(--bg-primary)]/70 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"}`}
                      >
                        <VoicePersonIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setAgentOverlayMode("immersive")}
                        title="Enter fullscreen visual mode"
                        aria-label="Enter fullscreen visual mode"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-primary)]/70 text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9V5.25A1.5 1.5 0 0 1 5.25 3.75H9m6 0h3.75A1.5 1.5 0 0 1 20.25 5.25V9m0 6v3.75a1.5 1.5 0 0 1-1.5 1.5H15m-6 0H5.25a1.5 1.5 0 0 1-1.5-1.5V15" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <VoiceSelectModal
        open={voicePickerOpen}
        title="Voice"
        value={resolvedVoiceSettings}
        helperText="Applies to this chat only. Go to Team > Agent to change the agent default."
        onClose={() => setVoicePickerOpen(false)}
        onSelect={(voiceSettings) => {
          setSessionVoiceOverride(voiceSettings);
          setVoicePickerOpen(false);
        }}
      />

      {/* Input area — Claude-style layout */}
      <div className={`shrink-0 bg-[var(--bg-primary)]/50 backdrop-blur-xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 lg:px-6 transition-opacity ${isPaused ? "opacity-60" : ""}`}>
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            value={input}
            onValueChange={setInput}
            placeholder={composerPlaceholder}
            pendingFiles={pendingFiles}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onSend={(text) => sendMessage(text)}
            onTranscript={sendMessage}
            isLoading={isLoading}
            speakResponses={speakResponses}
            onToggleSpeak={() => {
              if (speakResponses) stopAllAudio();
              setSpeakResponses(!speakResponses);
            }}
            onEnterAgentMode={() => {
              if (voiceMode === "agent") {
                stopAllAudio();
                setVoiceMode("off");
                setAgentModeSessionKey(null);
                setAgentOverlayMode("transcript");
                setAgentMicMuted(false);
                setAgentAudioMuted(false);
                return;
              }
              if (!isNativeCapacitorApp() && audioRef.current) {
                audioRef.current.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
                audioRef.current.play().catch(() => {});
              }
              setAgentMicMuted(false);
              setAgentAudioMuted(false);
              setAgentOverlayMode("transcript");
              setAgentModeSessionKey(activeSessionKey);
              setVoiceMode("agent");
              setSpeakResponses(true);
            }}
            agentButtonTitle={voiceMode === "agent" ? "Exit voice mode" : "Enter agent mode (hands-free)"}
            isDragOver={isDragOver}
            onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(event) => { event.preventDefault(); setIsDragOver(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragOver(false);
              if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
            }}
          />
        </div>
        </div>
      </div>
    </div>
    </div>
  );
}
