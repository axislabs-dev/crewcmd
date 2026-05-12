import { and, asc, eq, sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions, chatThreads } from "@/db/schema";

function stableThreadLinkId(id: string | null | undefined) {
  return id?.replace(/(?::item:|-item-)\d+$/i, "") ?? null;
}

function threadSessionSuffix(parentSessionKey: string, sessionKey: string | null | undefined) {
  if (!sessionKey) return null;
  const prefix = `${parentSessionKey.toLowerCase()}:thread:`;
  const lower = sessionKey.toLowerCase();
  return lower.startsWith(prefix) ? lower.slice(prefix.length) : null;
}

type ThreadReplySummary = {
  parentMessageId: string;
  parentMessageKey: string;
  sessionKey: string;
  replyCount: number;
  lastReplyAt: Date | string | null;
  replies: Array<{ id: string; role: string; createdAt: Date | string }>;
};

export type ChatPersistenceScope = {
  companyId?: string | null;
  workspaceId?: string | null;
};

function sessionScopeWhere(scope: ChatPersistenceScope) {
  return scope.companyId
    ? eq(chatSessions.companyId, scope.companyId)
    : eq(chatSessions.workspaceId, scope.workspaceId!);
}

function threadScopeWhere(scope: ChatPersistenceScope) {
  return scope.companyId
    ? eq(chatThreads.companyId, scope.companyId)
    : eq(chatThreads.workspaceId, scope.workspaceId!);
}

function threadParentMessageKey(parentMessageId: string | null | undefined) {
  const stableId = stableThreadLinkId(parentMessageId);
  return stableId ? `id:${stableId}` : null;
}

function shouldReplaceThreadSummary(existing: ThreadReplySummary | undefined, candidate: ThreadReplySummary) {
  if (!existing) return true;
  const existingLastReplyAt = existing.lastReplyAt ? new Date(existing.lastReplyAt).getTime() : 0;
  const candidateLastReplyAt = candidate.lastReplyAt ? new Date(candidate.lastReplyAt).getTime() : 0;

  if (candidateLastReplyAt !== existingLastReplyAt) {
    return candidateLastReplyAt > existingLastReplyAt;
  }
  if (candidate.replyCount !== existing.replyCount) {
    return candidate.replyCount > existing.replyCount;
  }
  return candidate.sessionKey.localeCompare(existing.sessionKey) > 0;
}

export async function loadThreadHistoryForParent(parentSessionKey: string, scope: ChatPersistenceScope, limit: number) {
  if (!scope.companyId && !scope.workspaceId) {
    return { threads: [], threadSummaries: {}, threadIndex: {} };
  }
  const threadPrefix = `${parentSessionKey}:thread:`;
  const aggregateThreads = await withRetry(() =>
    db!.select({
      id: chatThreads.id,
      agentId: chatThreads.agentId,
      gatewaySessionKey: chatThreads.threadSessionKey,
      threadParentSessionId: chatThreads.parentSessionId,
      threadParentSessionKey: chatThreads.parentSessionKey,
      threadParentMessageId: chatThreads.parentMessageId,
      threadSessionId: chatThreads.threadSessionId,
    }).from(chatThreads)
      .where(and(
        threadScopeWhere(scope),
        eq(chatThreads.parentSessionKey, parentSessionKey)
      ))
      .orderBy(asc(chatThreads.updatedAt))
      .limit(200)
  );
  const threadSessions = await withRetry(() =>
    db!.select({
      id: chatSessions.id,
      agentId: chatSessions.agentId,
      gatewaySessionKey: chatSessions.gatewaySessionKey,
      threadParentSessionId: chatSessions.threadParentSessionId,
      threadParentSessionKey: chatSessions.threadParentSessionKey,
      threadParentMessageId: chatSessions.threadParentMessageId,
    }).from(chatSessions)
      .where(and(
        sessionScopeWhere(scope),
        eq(chatSessions.threadParentSessionKey, parentSessionKey)
      ))
      .orderBy(asc(chatSessions.updatedAt))
      .limit(200)
  );
  const legacyThreadSessions = await withRetry(() =>
    db!.select({
      id: chatSessions.id,
      agentId: chatSessions.agentId,
      gatewaySessionKey: chatSessions.gatewaySessionKey,
      threadParentSessionId: chatSessions.threadParentSessionId,
      threadParentSessionKey: chatSessions.threadParentSessionKey,
      threadParentMessageId: chatSessions.threadParentMessageId,
    }).from(chatSessions)
      .where(and(
        sessionScopeWhere(scope),
        sql`${chatSessions.gatewaySessionKey} like ${`${threadPrefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`} escape '\\'`
      ))
      .orderBy(asc(chatSessions.gatewaySessionKey))
      .limit(200)
  );
  const sessionsById = new Map(
    [...threadSessions, ...legacyThreadSessions].map((session) => [session.id, session])
  );
  const sessionsByKey = new Map(
    Array.from(sessionsById.values())
      .filter((session) => session.gatewaySessionKey)
      .map((session) => [session.gatewaySessionKey!, { ...session, threadSessionId: session.id as string | null }])
  );
  for (const thread of aggregateThreads) {
    sessionsByKey.set(thread.gatewaySessionKey, thread);
  }

  const threads = await Promise.all(
    Array.from(sessionsByKey.values())
      .filter((session) => session.gatewaySessionKey)
      .map(async (session) => {
        const parentMessageId =
          stableThreadLinkId(session.threadParentMessageId) ??
          stableThreadLinkId(threadSessionSuffix(parentSessionKey, session.gatewaySessionKey));
        const messages = await withRetry(() =>
          db!.select().from(chatMessages)
            .where(eq(chatMessages.sessionId, session.threadSessionId ?? session.id))
            .orderBy(asc(chatMessages.createdAt))
            .limit(limit)
        );
        return {
          sessionId: session.threadSessionId ?? session.id,
          agentId: session.agentId,
          sessionKey: session.gatewaySessionKey,
          parentSessionId: session.threadParentSessionId,
          parentSessionKey: session.threadParentSessionKey ?? parentSessionKey,
          parentMessageId,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            metadata: m.metadata,
          })),
        };
      })
  );

  const threadIndex: Record<string, ThreadReplySummary> = {};

  for (const thread of threads) {
    if (!thread.sessionKey || !thread.parentMessageId) continue;
    const parentMessageKey = threadParentMessageKey(thread.parentMessageId);
    if (!parentMessageKey) continue;
    const replies = thread.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
      }));
    if (replies.length === 0) continue;

    const summary: ThreadReplySummary = {
      parentMessageId: stableThreadLinkId(thread.parentMessageId) ?? thread.parentMessageId,
      parentMessageKey,
      sessionKey: thread.sessionKey,
      replyCount: replies.length,
      lastReplyAt: replies.at(-1)?.createdAt ?? null,
      replies,
    };
    if (shouldReplaceThreadSummary(threadIndex[parentMessageKey], summary)) {
      threadIndex[parentMessageKey] = summary;
    }
  }

  const threadSummaries = Object.fromEntries(
    Object.values(threadIndex).map((summary) => [summary.parentMessageId, summary])
  );

  return { threads, threadSummaries, threadIndex };
}
