import { asc, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatSessionEvents } from "@/db/schema";

export type PersistedChatProgressEvent = {
  type: "chat_progress";
  event?: string;
  at?: string;
  sessionKey?: string;
  terminalStatus?: unknown;
  [key: string]: unknown;
};

export type ChatExecutionSnapshot = {
  progress: PersistedChatProgressEvent | null;
  events: PersistedChatProgressEvent[];
};

const TERMINAL_EVENTS = new Set(["run_completed", "run_error", "run_aborted"]);
const TERMINAL_STATUSES = new Set(["completed", "error", "aborted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPersistedChatProgressEvent(value: unknown): value is PersistedChatProgressEvent {
  return isRecord(value) && value.type === "chat_progress";
}

function isTerminalProgressEvent(event: PersistedChatProgressEvent) {
  return (
    (typeof event.event === "string" && TERMINAL_EVENTS.has(event.event)) ||
    (typeof event.terminalStatus === "string" && TERMINAL_STATUSES.has(event.terminalStatus))
  );
}

export function buildChatExecutionSnapshot(
  events: PersistedChatProgressEvent[],
): ChatExecutionSnapshot {
  const valid = events.filter(isPersistedChatProgressEvent);
  if (valid.length === 0) return { progress: null, events: [] };

  const last = valid[valid.length - 1];
  if (isTerminalProgressEvent(last)) return { progress: null, events: valid.slice(-40) };
  return { progress: last, events: valid.slice(-40) };
}

export async function persistChatProgressEvent(input: {
  sessionId: string | null;
  companyId: string | null;
  agentId: string;
  gatewaySessionKey: string;
  payload: PersistedChatProgressEvent;
}) {
  if (!db || !input.sessionId || !input.companyId) return;

  await withRetry(() =>
    db!.insert(chatSessionEvents).values({
      sessionId: input.sessionId!,
      companyId: input.companyId!,
      agentId: input.agentId.toLowerCase(),
      gatewaySessionKey: input.gatewaySessionKey,
      eventType: input.payload.event ?? "chat_progress",
      payload: input.payload,
    })
  );
}

export async function loadChatExecutionEvents(sessionId: string, limit = 200) {
  if (!db) return [];

  const rows = await withRetry(() =>
    db!.select().from(chatSessionEvents)
      .where(eq(chatSessionEvents.sessionId, sessionId))
      .orderBy(asc(chatSessionEvents.createdAt))
      .limit(limit)
  );

  return rows
    .map((row) => row.payload)
    .filter(isPersistedChatProgressEvent);
}
