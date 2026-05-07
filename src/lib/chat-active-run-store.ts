"use client";

import { create } from "zustand";

export type ChatRunTerminalStatus =
  | "idle"
  | "starting"
  | "sending"
  | "running"
  | "completed"
  | "aborted"
  | "error";

export interface ChatRunActivity {
  name: string;
  status?: string | null;
  detail?: string | null;
}

export interface ChatProgressPayload {
  type?: string;
  event?: string;
  at?: string;
  sessionKey?: string;
  runId?: string;
  activeTool?: unknown;
  tool?: unknown;
  toolName?: unknown;
  activeSubagent?: unknown;
  subagent?: unknown;
  subagentName?: unknown;
  terminalStatus?: unknown;
}

interface BeginRunInput {
  sessionKey: string;
  at?: string;
}

interface RunAckInput {
  sessionKey?: string;
  runId?: string | null;
  at?: string;
}

interface ActiveChatRunState {
  runId: string | null;
  sessionKey: string | null;
  isSending: boolean;
  lastEventAt: string | null;
  activeTool: ChatRunActivity | null;
  activeSubagent: ChatRunActivity | null;
  terminalStatus: ChatRunTerminalStatus;
  beginRun: (input: BeginRunInput) => void;
  acknowledgeRun: (input: RunAckInput) => boolean;
  applyProgressEvent: (event: ChatProgressPayload) => boolean;
  reset: () => void;
}

const initialState = {
  runId: null,
  sessionKey: null,
  isSending: false,
  lastEventAt: null,
  activeTool: null,
  activeSubagent: null,
  terminalStatus: "idle" as ChatRunTerminalStatus,
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readActivity(value: unknown): ChatRunActivity | null {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim(), status: null };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = readString(record.name) ?? readString(record.id) ?? readString(record.command);
  if (!name) return null;

  return {
    name,
    status: readString(record.status) ?? readString(record.state),
    detail: readString(record.detail) ?? readString(record.summary),
  };
}

function terminalStatusForEvent(event: string | undefined): ChatRunTerminalStatus | null {
  switch (event) {
    case "run_started":
      return "starting";
    case "gateway_send_started":
      return "sending";
    case "heartbeat":
    case "tool_started":
    case "tool_updated":
    case "tool_completed":
    case "connection_interrupted":
    case "connection_recovering":
      return "running";
    case "run_completed":
      return "completed";
    case "run_aborted":
      return "aborted";
    case "run_error":
      return "error";
    default:
      return null;
  }
}

function isTerminal(status: ChatRunTerminalStatus | null) {
  return status === "completed" || status === "aborted" || status === "error";
}

function isStaleEvent(
  state: Pick<ActiveChatRunState, "runId" | "sessionKey" | "lastEventAt">,
  event: Pick<ChatProgressPayload, "runId" | "sessionKey" | "at">
) {
  const activeSession = normalize(state.sessionKey);
  const eventSession = normalize(event.sessionKey);
  if (activeSession && eventSession && activeSession !== eventSession) {
    return true;
  }

  if (state.runId && event.runId && state.runId !== event.runId) {
    return true;
  }

  if (state.lastEventAt && event.at) {
    const lastEventTime = Date.parse(state.lastEventAt);
    const eventTime = Date.parse(event.at);
    if (Number.isFinite(lastEventTime) && Number.isFinite(eventTime) && eventTime < lastEventTime) {
      return true;
    }
  }

  return false;
}

export const useActiveChatRunStore = create<ActiveChatRunState>((set, get) => ({
  ...initialState,

  beginRun: ({ sessionKey, at }) =>
    set({
      ...initialState,
      sessionKey,
      isSending: true,
      lastEventAt: at ?? new Date().toISOString(),
      terminalStatus: "starting",
    }),

  acknowledgeRun: ({ sessionKey, runId, at }) => {
    const state = get();
    if (isStaleEvent(state, { sessionKey, runId: runId ?? undefined })) {
      return false;
    }

    set({
      sessionKey: sessionKey ?? state.sessionKey,
      runId: runId ?? state.runId,
      isSending: true,
      lastEventAt: at ?? new Date().toISOString(),
      terminalStatus: "running",
    });
    return true;
  },

  applyProgressEvent: (event) => {
    if (event.type !== "chat_progress") return false;

    const state = get();
    if (isStaleEvent(state, event)) return false;

    const terminalStatus =
      readString(event.terminalStatus) as ChatRunTerminalStatus | null
      ?? terminalStatusForEvent(event.event)
      ?? state.terminalStatus;
    const activeTool =
      readActivity(event.activeTool) ?? readActivity(event.tool) ?? readActivity(event.toolName);
    const activeSubagent =
      readActivity(event.activeSubagent) ?? readActivity(event.subagent) ?? readActivity(event.subagentName);
    const completed = isTerminal(terminalStatus);

    set({
      sessionKey: event.sessionKey ?? state.sessionKey,
      runId: event.runId ?? state.runId,
      isSending: completed ? false : true,
      lastEventAt: event.at ?? new Date().toISOString(),
      activeTool: completed ? null : activeTool ?? state.activeTool,
      activeSubagent: completed ? null : activeSubagent ?? state.activeSubagent,
      terminalStatus,
    });
    return true;
  },

  reset: () => set(initialState),
}));
