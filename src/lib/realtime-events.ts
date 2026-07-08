import { asc, eq, gt, and } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatSessions, realtimeEvents } from "@/db/schema";
import { publishRealtimeChatEvent } from "@/lib/chat-pubsub";
import type { PersistedChatProgressEvent } from "@/lib/chat-session-events";

type ChatSessionRow = typeof chatSessions.$inferSelect;
export type RealtimeEventRow = typeof realtimeEvents.$inferSelect;

export function normalizeRealtimeCursor(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildEnvelope(params: {
  event: RealtimeEventRow;
  payload: Record<string, unknown>;
}) {
  const event = params.event;
  return {
    id: event.id,
    sequence: String(event.sequence),
    type: event.type,
    occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
    scope: {
      companyId: event.companyId ?? null,
      workspaceId: event.workspaceId ?? null,
      channelId: event.channelId ?? null,
      sessionId: event.sessionId ?? null,
      sessionKey: event.sessionKey ?? null,
      threadParentSessionKey: event.threadParentSessionKey ?? null,
      threadSessionKey: event.threadSessionKey ?? null,
    },
    actor: {
      type: event.actorType ?? null,
      id: event.actorId ?? null,
    },
    resource: {
      type: event.resourceType,
      id: event.resourceId ?? null,
    },
    payload: params.payload,
  };
}

export function toClientRealtimeEvent(row: RealtimeEventRow) {
  return buildEnvelope({
    event: row,
    payload: row.payload,
  });
}

async function appendRealtimeEvent(values: typeof realtimeEvents.$inferInsert) {
  if (!db || !values.companyId) return null;

  const [event] = await withRetry(() =>
    db!.insert(realtimeEvents)
      .values(values)
      .returning()
  );

  publishRealtimeChatEvent({
    sequence: event.sequence,
    companyId: event.companyId,
    workspaceId: event.workspaceId,
    channelId: event.channelId,
    sessionId: event.sessionId,
  });

  return event;
}

export async function appendRealtimeChatMessageEvent(input: {
  session: ChatSessionRow;
  message: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown> | null;
    createdAt: Date;
  };
  actorType?: "user" | "agent" | "runtime" | "system";
  actorId?: string | null;
  interrupted?: boolean;
}) {
  if (!input.session.companyId) return null;

  return appendRealtimeEvent({
    type: "chat.message.created",
    resourceType: "chat_message",
    resourceId: input.message.id,
    companyId: input.session.companyId,
    workspaceId: input.session.workspaceId,
    channelId: input.session.channelId,
    sessionId: input.session.id,
    sessionKey: input.session.gatewaySessionKey,
    threadParentSessionKey: input.session.threadParentSessionKey,
    threadSessionKey: input.session.threadParentSessionId ? input.session.gatewaySessionKey : null,
    actorType: input.actorType ?? (input.message.role === "user" ? "user" : "agent"),
    actorId: input.actorId ?? (input.message.role === "user" ? null : input.session.agentId.toLowerCase()),
    occurredAt: input.message.createdAt,
    payload: {
      message: {
        id: input.message.id,
        sessionId: input.session.id,
        agentId: input.session.agentId.toLowerCase(),
        companyId: input.session.companyId,
        sessionKey: input.session.gatewaySessionKey,
        channelId: input.session.channelId,
        role: input.message.role,
        content: input.message.content,
        metadata: input.message.metadata ?? null,
        createdAt: input.message.createdAt.toISOString(),
        interrupted: input.interrupted,
      },
    },
  });
}

export async function appendRealtimeChatProgressEvent(input: {
  session: ChatSessionRow;
  progressEventId: string;
  payload: PersistedChatProgressEvent;
}) {
  if (!input.session.companyId) return null;

  const eventType = input.payload.event === "run_completed" || input.payload.event === "run_error" || input.payload.event === "run_aborted"
    ? "chat.progress.completed"
    : "chat.progress.updated";

  return appendRealtimeEvent({
    type: eventType,
    resourceType: "chat_progress",
    resourceId: input.progressEventId,
    companyId: input.session.companyId,
    workspaceId: input.session.workspaceId,
    channelId: input.session.channelId,
    sessionId: input.session.id,
    sessionKey: input.session.gatewaySessionKey,
    threadParentSessionKey: input.session.threadParentSessionKey,
    threadSessionKey: input.session.threadParentSessionId ? input.session.gatewaySessionKey : null,
    actorType: "runtime",
    actorId: input.session.agentId.toLowerCase(),
    payload: {
      progress: {
        ...input.payload,
        type: "chat_progress",
        sessionId: input.session.id,
        agentId: input.session.agentId.toLowerCase(),
        companyId: input.session.companyId,
        sessionKey: input.payload.sessionKey ?? input.session.gatewaySessionKey,
        channelId: input.session.channelId,
      },
    },
  });
}

export async function loadRealtimeEventsAfterCursor(input: {
  companyId: string;
  lastEventId: number;
  limit?: number;
}) {
  if (!db) return [];
  return withRetry(() =>
    db!.select().from(realtimeEvents)
      .where(and(
        eq(realtimeEvents.companyId, input.companyId),
        gt(realtimeEvents.sequence, input.lastEventId),
      ))
      .orderBy(asc(realtimeEvents.sequence))
      .limit(input.limit ?? 500)
  );
}

export async function loadRealtimeEventBySequence(sequence: number) {
  if (!db) return null;
  const [event] = await withRetry(() =>
    db!.select().from(realtimeEvents)
      .where(eq(realtimeEvents.sequence, sequence))
      .limit(1)
  );
  return event ?? null;
}
