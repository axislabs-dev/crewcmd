import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient, holdClient, releaseClient } from "@/lib/gateway-chat-pool";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { publishChatEvent } from "@/lib/chat-pubsub";
import { selectRecoveredAssistantText } from "@/lib/chat-recovery";
import {
  createAgentModeSessionId,
  publishAgentModeDiagnostic,
} from "@/lib/agent-mode-diagnostics";

export const dynamic = "force-dynamic";

const ACTIVE_HISTORY_POLL_INTERVAL_MS = 1_500;
const ACTIVE_HISTORY_POLL_MAX_ATTEMPTS = 80;
const AGENT_MODE_THINKING_LEVEL = "low";

type ChatProgressEventName =
  | "run_started"
  | "gateway_send_started"
  | "heartbeat"
  | "tool_started"
  | "tool_updated"
  | "tool_completed"
  | "run_completed"
  | "run_error"
  | "run_aborted";

type ChatProgressEvent = {
  type: "chat_progress";
  event: ChatProgressEventName;
  at: string;
  elapsedMs: number;
  agentId: string;
  gatewayAgentId: string;
  sessionKey: string;
  runId?: string;
  error?: string;
  activeTool?: {
    id?: string;
    name: string;
    status?: string;
    detail?: string;
  };
};

/**
 * Find-or-create a chat session for an agent+company pair.
 * Returns the session ID.
 */
async function resolveSessionId(
  agentId: string,
  companyId: string,
  gatewaySessionKey?: string | null,
): Promise<string> {
  const agentLower = agentId.toLowerCase();

  const existing = await withRetry(() =>
    db!.select().from(chatSessions)
      .where(and(
        eq(chatSessions.agentId, agentLower),
        eq(chatSessions.companyId, companyId)
      ))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(1)
  );

  if (existing.length > 0) {
    const session = existing[0];
    // Link gateway session key if not already set
    if (gatewaySessionKey && !session.gatewaySessionKey) {
      await withRetry(() =>
        db!.update(chatSessions)
          .set({ gatewaySessionKey })
          .where(eq(chatSessions.id, session.id))
      );
    }
    return session.id;
  }

  const [newSession] = await withRetry(() =>
    db!.insert(chatSessions).values({
      companyId,
      agentId: agentLower,
      gatewaySessionKey: gatewaySessionKey || null,
    }).returning()
  );
  return newSession.id;
}

function resolveSessionKeyForAgent(agentId: string, requestedSessionKey: unknown) {
  const agentKey = agentId === "main" ? "main" : agentId.toLowerCase();
  if (typeof requestedSessionKey !== "string" || !requestedSessionKey.trim()) {
    return agentKey;
  }

  const sessionKey = requestedSessionKey.trim();
  const lower = sessionKey.toLowerCase();
  if (lower === agentKey || lower.startsWith(`${agentKey}:`)) {
    return sessionKey;
  }

  return agentKey;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const str = asString(value);
    if (str) return str;
  }
  return null;
}

function isChatHistoryRpcTimeout(error: unknown) {
  return error instanceof Error && error.message === "RPC timeout: chat.history";
}

function extractText(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (!value) return "";

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item, seen)).filter(Boolean).join("");
  }

  const record = asRecord(value);
  if (!record) return "";
  if (seen.has(record)) return "";
  seen.add(record);

  const direct = firstString(
    record.text,
    record.content,
    record.output,
    record.result,
    record.response,
    record.answer,
    record.finalOutput,
    record.final_output,
    record.message,
    record.body,
  );
  if (direct) return direct;

  const nestedKeys = [
    "content",
    "message",
    "result",
    "response",
    "output",
    "finalOutput",
    "final_output",
    "data",
    "payload",
  ];

  for (const key of nestedKeys) {
    const nested = extractText(record[key], seen);
    if (nested) return nested;
  }

  return "";
}

function extractEventSession(payload: Record<string, unknown>) {
  const session = asRecord(payload.session);
  return firstString(
    payload.sessionKey,
    payload.session_key,
    payload.session,
    session?.key,
    session?.sessionKey,
    session?.session_key,
  );
}

function extractEventRunIds(payload: Record<string, unknown>) {
  return [
    payload.runId,
    payload.run_id,
    payload.id,
    payload.requestId,
    payload.request_id,
    payload.parentRunId,
    payload.parent_run_id,
  ].map(asString).filter((value): value is string => Boolean(value));
}

function stringifyShort(value: unknown, maxLength = 160) {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function extractToolProgress(payload: Record<string, unknown>) {
  const stream = firstString(payload.stream, payload.event);
  const streamKey = stream?.toLowerCase() ?? "";
  const data = asRecord(payload.data) ?? asRecord(payload.payload) ?? payload;
  const kind = firstString(data.kind, data.type, payload.kind, payload.type)?.toLowerCase() ?? "";
  const isToolEvent = streamKey === "tool" ||
    streamKey === "tool_call" ||
    streamKey === "agent.tool" ||
    streamKey.includes("tool") ||
    kind.includes("tool") ||
    Boolean(firstString(data.toolCallId, data.tool_call_id, data.toolName, data.tool_name));
  if (!isToolEvent) return null;
  const toolCallId = firstString(data.toolCallId, data.tool_call_id, payload.toolCallId, payload.tool_call_id);
  const name = firstString(data.name, data.toolName, data.tool_name, payload.toolName, payload.tool_name) ?? "tool";
  const phase = firstString(data.phase, data.status, data.state, payload.phase, payload.status, payload.state) ?? "update";
  const normalizedPhase = phase.toLowerCase();

  const event: ChatProgressEventName = ["start", "started", "call", "calling", "running"].includes(normalizedPhase)
    ? "tool_started"
    : ["result", "end", "ended", "complete", "completed", "success", "succeeded"].includes(normalizedPhase)
      ? "tool_completed"
      : "tool_updated";

  const detail = event === "tool_started"
    ? stringifyShort(data.args ?? data.arguments ?? data.input)
    : stringifyShort(data.partialResult ?? data.partial_result ?? data.result ?? data.output);

  return {
    event,
    activeTool: {
      ...(toolCallId ? { id: toolCallId } : {}),
      name,
      status: phase,
      ...(detail ? { detail } : {}),
    },
  };
}

function extractActivityProgress(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? asRecord(payload.payload) ?? payload;
  const label = firstString(
    data.label,
    data.title,
    data.summary,
    data.message,
    data.statusText,
    data.status_text,
    data.command,
    data.name,
    payload.label,
    payload.title,
    payload.message,
  );
  if (!label) return null;

  const stream = firstString(payload.stream, payload.event);
  const phase = firstString(data.phase, data.status, data.state, payload.state);
  const kind = firstString(data.kind, data.type, stream) ?? "activity";
  const detail = stringifyShort(
    data.detail ??
    data.description ??
    data.args ??
    data.arguments ??
    data.input ??
    data.output ??
    data.result,
    220
  );

  return {
    event: "tool_updated" as ChatProgressEventName,
    activeTool: {
      name: label,
      status: phase ?? kind,
      ...(detail ? { detail } : {}),
    },
  };
}

function sessionMatches(eventSession: string | null, allowedSessions: string[]) {
  if (!eventSession) return true;
  const event = eventSession.toLowerCase();

  return allowedSessions.some((session) => {
    const allowed = session.toLowerCase();
    return event === allowed ||
      event.startsWith(`${allowed}:`) ||
      event.startsWith(`${allowed}-`) ||
      event.endsWith(`:${allowed}`);
  });
}

function extractHistoryMessages(result: unknown) {
  const record = asRecord(result);
  const messages = Array.isArray(record?.messages)
    ? record.messages
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(result)
        ? result
        : [];

  return messages
    .map((item) => {
      const message = asRecord(item);
      const role = firstString(message?.role, message?.type, message?.author);
      const content = extractText(message?.content ?? message?.message ?? message);
      return { role, content };
    })
    .filter((message) => message.content);
}

function gatewaySessionSortValue(session: Record<string, unknown>) {
  const updatedAt = session.updatedAt ?? session.updated_at ?? session.lastActive ?? session.last_active;
  if (typeof updatedAt === "number") return updatedAt;
  if (typeof updatedAt === "string") {
    const parsed = Date.parse(updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function recoverAssistantTextFromGateway(params: {
  client: {
    chatHistory: (params: { sessionKey?: string; limit?: number }) => Promise<unknown>;
    rpc: <T = unknown>(method: string, params: Record<string, unknown>) => Promise<T>;
  };
  allowedSessions: string[];
  currentUserContents: string[];
  previousAssistantContents: string[];
}) {
  const candidateKeys = new Set(params.allowedSessions.map((session) => session.toLowerCase()));

  try {
    const result = await params.client.rpc<Record<string, unknown>>("sessions.list", {});
    const sessions = ((result.sessions as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((session) => {
        const key = firstString(session.key, session.sessionKey, session.session_key);
        const spawnedBy = firstString(session.spawnedBy, session.spawnedByKey, session.spawned_by_key);
        return Boolean(key) && (
          sessionMatches(key, params.allowedSessions) ||
          sessionMatches(spawnedBy, params.allowedSessions)
        );
      })
      .sort((a, b) => gatewaySessionSortValue(b) - gatewaySessionSortValue(a))
      .slice(0, 8);

    for (const session of sessions) {
      const key = firstString(session.key, session.sessionKey, session.session_key);
      if (key) candidateKeys.add(key.toLowerCase());
    }
  } catch (error) {
    console.error("[api/chat] Failed to list sessions for recovery:", error);
  }

  for (const sessionKey of candidateKeys) {
    try {
      const result = await params.client.chatHistory({ sessionKey, limit: 25 });
      const messages = extractHistoryMessages(result);
      if (messages.length === 0) continue;

      const recovered = selectRecoveredAssistantText({
        messages,
        currentUserContents: params.currentUserContents,
        previousAssistantContents: params.previousAssistantContents,
      });
      if (recovered) return recovered;
    } catch (error) {
      if (isChatHistoryRpcTimeout(error)) {
        publishAgentModeDiagnostic({
          scope: "api-chat",
          event: "history-recovery.timeout",
          detail: { sessionKey },
        });
      } else {
        console.error(`[api/chat] Failed to recover chat history for ${sessionKey}:`, error);
      }
    }
  }

  return "";
}

async function selectAssistantTextFromHistory(params: {
  client: {
    chatHistory: (params: { sessionKey?: string; limit?: number }) => Promise<unknown>;
  };
  sessionKey: string;
  currentUserContents: string[];
  previousAssistantContents: string[];
}) {
  try {
    const result = await params.client.chatHistory({ sessionKey: params.sessionKey, limit: 25 });
    const messages = extractHistoryMessages(result);
    if (messages.length === 0) return "";

    return selectRecoveredAssistantText({
      messages,
      currentUserContents: params.currentUserContents,
      previousAssistantContents: params.previousAssistantContents,
    });
  } catch (error) {
    if (isChatHistoryRpcTimeout(error)) {
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "history-poll.timeout",
        detail: { sessionKey: params.sessionKey },
      });
    } else {
      console.error(`[api/chat] Failed to poll chat history for ${params.sessionKey}:`, error);
    }
    return "";
  }
}

function buildDelegatedAgentMessage(params: {
  message: string;
  targetAgent: unknown;
}) {
  if (!params.targetAgent || typeof params.targetAgent !== "object") {
    return params.message;
  }

  const target = params.targetAgent as Record<string, unknown>;
  const callsign = asString(target.callsign);
  if (!callsign) return params.message;

  const name = asString(target.name);
  const title = asString(target.title);
  const runtimeRef = asString(target.runtimeRef);

  const identity = [
    `callsign: ${callsign}`,
    name ? `name: ${name}` : null,
    title ? `role: ${title}` : null,
    runtimeRef ? `runtimeRef: ${runtimeRef}` : null,
  ].filter(Boolean).join(", ");

  return [
    "CrewCmd delegation request.",
    "",
    "OpenClaw only accepts direct chat through the runtime's main agent. The human selected a non-main agent in CrewCmd, so route this turn to that agent using your OpenClaw session/subagent tools and return the selected agent's response. Prefer sessions_send for an existing target session and sessions_spawn if a session does not exist.",
    "",
    `Selected agent: ${identity}`,
    "",
    "Do not answer as the main agent unless delegation fails. If delegation fails, say exactly why.",
    "",
    "Human message:",
    params.message,
  ].join("\n");
}

/**
 * Persist a message to the DB and publish to the event bus.
 * Returns the DB record.
 */
async function persistAndPublish(
  sessionId: string,
  agentId: string,
  companyId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown> | null,
  interrupted?: boolean,
) {
  const [message] = await withRetry(() =>
    db!.insert(chatMessages).values({
      sessionId,
      role,
      content,
      metadata: metadata || null,
    }).returning()
  );

  // Touch session updatedAt
  await withRetry(() =>
    db!.update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
  );

  publishChatEvent({
    id: message.id,
    sessionId,
    agentId: agentId.toLowerCase(),
    companyId,
    role,
    content,
    metadata: metadata || null,
    createdAt: message.createdAt.toISOString(),
    interrupted,
  });

  return message;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      messages,
      agent,
      gatewayAgent,
      targetAgent,
      companyId: bodyCompanyId,
      sessionKey: bodySessionKey,
      agentMode: bodyAgentMode,
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Get the last user message
    const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    if (!lastUserMessage) {
      return Response.json(
        { error: "No user message found" },
        { status: 400 }
      );
    }

    const agentId = asString(agent) || "main";
    const gatewayAgentId = asString(gatewayAgent) || agentId;
    const sessionKey = resolveSessionKeyForAgent(gatewayAgentId, bodySessionKey);
    const targetAgentRecord = asRecord(targetAgent);
    const targetAgentCallsign = asString(targetAgentRecord?.callsign);
    const allowedEventSessions = [
      sessionKey,
      agentId,
      gatewayAgentId,
      targetAgentCallsign,
    ].filter((value): value is string => Boolean(value));
    const activeHistorySessionKeys = Array.from(
      new Map(allowedEventSessions.map((value) => [value.toLowerCase(), value])).values()
    );
    const outboundMessage = buildDelegatedAgentMessage({
      message: lastUserMessage.content,
      targetAgent,
    });
    const scopedThinkingLevel = bodyAgentMode === true ? AGENT_MODE_THINKING_LEVEL : undefined;
    const currentUserContents = [lastUserMessage.content, outboundMessage];
    const previousAssistantContents = messages
      .slice(0, messages.lastIndexOf(lastUserMessage))
      .filter((message: { role?: string }) => message.role === "assistant")
      .map((message: { content?: unknown }) => asString(message.content))
      .filter((content: string | null): content is string => Boolean(content));

    // Resolve company ID from body or cookie
    const companyId = bodyCompanyId ||
      request.cookies.get("active_company")?.value ||
      "";

    // --- Server-side persistence: persist user message BEFORE sending to gateway ---
    let userMessageId: string | null = null;
    let sessionId: string | null = null;

    if (db && companyId) {
      try {
        sessionId = await resolveSessionId(agentId, companyId, sessionKey);
        const userMsg = await persistAndPublish(
          sessionId,
          agentId,
          companyId,
          "user",
          lastUserMessage.content,
          body.metadata || null,
        );
        userMessageId = userMsg.id;
      } catch (err) {
        console.error("[api/chat] Failed to persist user message:", err);
        // Continue — gateway chat still works without DB
      }
    }

    const requestStartedAt = Date.now();
    const diagnosticSessionId = createAgentModeSessionId("chat-route");
    publishAgentModeDiagnostic({
      scope: "api-chat",
      event: "request.start",
      sessionId: diagnosticSessionId,
      detail: {
        agentId,
        gatewayAgentId,
        sessionKey,
        messageCount: messages.length,
        hasCompanyId: Boolean(companyId),
      },
    });
    // Set up SSE stream
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;
    const cleanupFns: Array<() => void> = [];
    let client: Awaited<ReturnType<typeof getGatewayClient>> | null = null;

    let done = false;
    let cancelled = false;
    let lastStreamedText = "";
    let fullAssistantText = "";
    let assistantPersisted = false;
    let activeRunId: string | null = null;
    let released = false;
    let gatewayAcquiredAt = 0;
    let gatewaySentAt = 0;
    let firstDeltaAt = 0;
    let inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let historyPollTimeout: ReturnType<typeof setTimeout> | null = null;
    let historyPollAttempts = 0;
    let historyPollInFlight = false;
    let historySnapshotStreamed = false;

    const enqueueData = (payload: unknown) => {
      if (!streamController || done) return;
      try {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // Stream may already be closed by the client.
      }
    };

    const enqueueProgress = (
      event: ChatProgressEventName,
      details: Partial<Pick<ChatProgressEvent, "runId" | "error" | "activeTool">> = {},
    ) => {
      if (!streamController || done) return;
      const payload: ChatProgressEvent = {
        type: "chat_progress",
        event,
        at: new Date().toISOString(),
        elapsedMs: Date.now() - requestStartedAt,
        agentId,
        gatewayAgentId,
        sessionKey,
        ...(details.runId ? { runId: details.runId } : {}),
        ...(details.error ? { error: details.error } : {}),
        ...(details.activeTool ? { activeTool: details.activeTool } : {}),
      };

      try {
        streamController.enqueue(encoder.encode(`event: chat_progress\ndata: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // Stream may already be closed by the client.
      }
    };

    const clearInactivityTimeout = () => {
      if (!inactivityTimeout) return;
      clearTimeout(inactivityTimeout);
      inactivityTimeout = null;
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "inactivity-timeout.clear",
        sessionId: diagnosticSessionId,
      });
    };

    const clearHeartbeat = () => {
      if (!heartbeatInterval) return;
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    };

    const stopHistoryPolling = () => {
      if (!historyPollTimeout) return;
      clearTimeout(historyPollTimeout);
      historyPollTimeout = null;
    };

    const streamAssistantSnapshot = (assistantText: string) => {
      if (!assistantText || !streamController || done) return false;

      if (lastStreamedText && !assistantText.startsWith(lastStreamedText)) {
        return false;
      }

      const newContent = assistantText.slice(lastStreamedText.length);
      fullAssistantText = assistantText;
      if (!newContent) return false;

      lastStreamedText = assistantText;
      const chunk = JSON.stringify({
        choices: [{ delta: { content: newContent } }],
      });
      streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      return true;
    };

    const startHeartbeat = () => {
      clearHeartbeat();
      heartbeatInterval = setInterval(() => {
        enqueueProgress("heartbeat", activeRunId ? { runId: activeRunId } : {});
      }, 30_000);
    };

    const armInactivityTimeout = (reason: string) => {
      clearInactivityTimeout();
      inactivityTimeout = setTimeout(() => {
        if (!done && streamController) {
          publishAgentModeDiagnostic({
            scope: "api-chat",
            event: "inactivity-timeout.fire",
            sessionId: diagnosticSessionId,
            detail: {
              activeRunId,
              hasAssistantText: Boolean(fullAssistantText),
              elapsedMs: Date.now() - requestStartedAt,
              reason,
            },
          });
          finishStream(true);
        }
      }, 300_000);
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "inactivity-timeout.arm",
        sessionId: diagnosticSessionId,
        detail: { timeoutMs: 300_000, reason },
      });
    };

    const pollActiveHistory = async () => {
      if (done || cancelled || !client || historyPollInFlight) return;
      if (historyPollAttempts >= ACTIVE_HISTORY_POLL_MAX_ATTEMPTS) return;

      historyPollAttempts += 1;
      historyPollInFlight = true;
      try {
        for (const historySessionKey of activeHistorySessionKeys) {
          if (done || cancelled || !client) break;
          const assistantText = await selectAssistantTextFromHistory({
            client,
            sessionKey: historySessionKey,
            currentUserContents,
            previousAssistantContents,
          });
          if (assistantText && streamAssistantSnapshot(assistantText)) {
            historySnapshotStreamed = true;
            armInactivityTimeout("chat-history");
            publishAgentModeDiagnostic({
              scope: "api-chat",
              event: "history-poll.delta",
              sessionId: diagnosticSessionId,
              detail: {
                historySessionKey,
                activeRunId,
                elapsedMs: Date.now() - requestStartedAt,
              },
            });
          }
        }
      } finally {
        historyPollInFlight = false;
        if (!done && !cancelled && historyPollAttempts < ACTIVE_HISTORY_POLL_MAX_ATTEMPTS) {
          historyPollTimeout = setTimeout(() => {
            historyPollTimeout = null;
            void pollActiveHistory();
          }, ACTIVE_HISTORY_POLL_INTERVAL_MS);
        }
      }
    };

    const startHistoryPolling = () => {
      stopHistoryPolling();
      if (done || cancelled || !client) return;
      historyPollTimeout = setTimeout(() => {
        historyPollTimeout = null;
        void pollActiveHistory();
      }, 0);
    };

    const releaseHeldClient = () => {
      if (released || !client) return;
      released = true;
      releaseClient(client);
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "gateway-client.release",
        sessionId: diagnosticSessionId,
      });
    };

    const recoverMissingAssistantText = async () => {
      if ((!historySnapshotStreamed && fullAssistantText) || !client) return;
      const recovered = await recoverAssistantTextFromGateway({
        client,
        allowedSessions: allowedEventSessions,
        currentUserContents,
        previousAssistantContents,
      });
      if (!recovered) return;

      streamAssistantSnapshot(recovered);
    };

    const finishStream = async (
      interrupted: boolean,
      progressEvent: "run_completed" | "run_aborted" | null = interrupted ? "run_aborted" : "run_completed",
    ) => {
      if (done) return;
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "stream.finish.start",
        sessionId: diagnosticSessionId,
        detail: {
          interrupted,
          activeRunId,
          hasAssistantText: Boolean(fullAssistantText),
          elapsedMs: Date.now() - requestStartedAt,
        },
      });
      clearInactivityTimeout();
      stopHistoryPolling();
      await recoverMissingAssistantText();
      await persistAssistant(interrupted);
      if (progressEvent) {
        enqueueProgress(progressEvent, activeRunId ? { runId: activeRunId } : {});
      }
      done = true;
      try {
        streamController?.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController?.close();
      } catch { /* already closed */ }
      if (client) client.off("*", chatHandler);
      clearHeartbeat();
      releaseHeldClient();
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "stream.finish.complete",
        sessionId: diagnosticSessionId,
        detail: { interrupted },
      });
    };

    /**
     * Persist the assistant message (called on final, error, abort, cancel, timeout).
     * Guarded to run at most once.
     */
    const persistAssistant = async (interrupted: boolean) => {
      if (assistantPersisted || !db || !sessionId || !companyId) return;
      assistantPersisted = true;
      if (!fullAssistantText) return;

      const content = interrupted
        ? fullAssistantText + "\n\n_(interrupted)_"
        : fullAssistantText;

      try {
        const msg = await persistAndPublish(
          sessionId,
          agentId,
          companyId,
          "assistant",
          content,
          null,
          interrupted,
        );
        // Send assistant message ID to client as a meta event
        if (streamController && !done) {
          enqueueData({ type: "meta", messageId: msg.id, role: "assistant" });
        }
      } catch (err) {
        console.error("[api/chat] Failed to persist assistant message:", err);
      }
    };

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        enqueueProgress("run_started");
        startHeartbeat();

        // Send user message meta event with DB ID
        if (userMessageId) {
          enqueueData({ type: "meta", messageId: userMessageId, role: "user" });
        }
        enqueueProgress("gateway_send_started");
        enqueueData({
          type: "gateway_send_started",
          agentId,
          gatewayAgentId,
          sessionKey,
          elapsedMs: Date.now() - requestStartedAt,
        });
        queueMicrotask(() => {
          void startGatewayTurn();
        });
      },
      cancel() {
        cancelled = true;
        // Client disconnected — persist whatever was streamed so far
        publishAgentModeDiagnostic({
          scope: "api-chat",
          event: "stream.cancel",
          sessionId: diagnosticSessionId,
          detail: { elapsedMs: Date.now() - requestStartedAt },
        });
        clearInactivityTimeout();
        stopHistoryPolling();
        enqueueProgress("run_aborted", activeRunId ? { runId: activeRunId } : {});
        if (client) {
          client.chatAbort({ sessionKey }).catch((err) => {
            console.error("[api/chat] chat.abort failed:", err);
          });
        }
        void persistAssistant(true);
        for (const fn of cleanupFns) fn();
        clearHeartbeat();
        releaseHeldClient();
      },
    });

    const chatHandler = (payload: unknown) => {
      if (!streamController || done) return;
      const p = payload as Record<string, unknown>;

      // Filter: only handle events for THIS session
      const eventSession = extractEventSession(p);
      const eventRunIds = extractEventRunIds(p);
      const matchesSession = sessionMatches(eventSession, allowedEventSessions);
      const matchesRun = activeRunId
        ? eventRunIds.includes(activeRunId)
        : false;

      if (activeRunId && eventRunIds.length > 0 && !matchesRun && !matchesSession) {
        return;
      }
      if (!matchesSession) return;

      const state = p.state as string;
      const toolProgress = extractToolProgress(p);
      const activityProgress = toolProgress ? null : extractActivityProgress(p);
      armInactivityTimeout(`gateway-${state || toolProgress?.event || "event"}`);
      publishAgentModeDiagnostic({
        scope: "api-chat",
        event: "gateway.chat-event",
        sessionId: diagnosticSessionId,
        detail: {
          state,
          eventSession,
          matchesSession,
          matchesRun,
          activeRunId,
        },
      });

      if (toolProgress) {
        enqueueProgress(toolProgress.event, {
          ...(activeRunId ? { runId: activeRunId } : {}),
          activeTool: toolProgress.activeTool,
        });
      } else if (activityProgress) {
        enqueueProgress(activityProgress.event, {
          ...(activeRunId ? { runId: activeRunId } : {}),
          activeTool: activityProgress.activeTool,
        });
      }

      if (state === "delta") {
        const fullText = extractText(p.message || p);
        if (fullText && streamAssistantSnapshot(fullText)) {
          if (!firstDeltaAt) {
            firstDeltaAt = Date.now();
            console.info("[api/chat] first delta", {
              agentId,
              gatewayAgentId,
              sessionKey,
              gatewayAcquireMs: gatewayAcquiredAt - requestStartedAt,
              chatSendMs: gatewaySentAt ? gatewaySentAt - gatewayAcquiredAt : null,
              firstDeltaMs: firstDeltaAt - requestStartedAt,
            });
          }
        }
      } else if (state === "final") {
        const finalText = extractText(p.message || p);
        if (finalText && !streamAssistantSnapshot(finalText)) {
          fullAssistantText = finalText;
        }

        // Persist the complete assistant response
        finishStream(false);
      } else if (state === "aborted") {
        finishStream(true);
      } else if (state === "error") {
        const errorMsg = (p.errorMessage as string) || "Chat error";
        enqueueProgress("run_error", {
          ...(activeRunId ? { runId: activeRunId } : {}),
          error: errorMsg,
        });
        const chunk = JSON.stringify({
          choices: [{ delta: { content: `\n\nError: ${errorMsg}` } }],
        });
        streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        fullAssistantText += `\n\nError: ${errorMsg}`;

        finishStream(true, null);
      }
    };

    const startGatewayTurn = async () => {
      if (cancelled || done) return;
      try {
        client = await getGatewayClient();
        if (cancelled || done) {
          releaseHeldClient();
          return;
        }
        gatewayAcquiredAt = Date.now();
        publishAgentModeDiagnostic({
          scope: "api-chat",
          event: "gateway-client.acquire",
          sessionId: diagnosticSessionId,
          detail: { acquireMs: gatewayAcquiredAt - requestStartedAt },
        });
        holdClient(client);

        client.on("*", chatHandler);
        cleanupFns.push(() => {
          client?.off("*", chatHandler);
        });

        // Close only idle streams; active long-running turns reset this on gateway events.
        armInactivityTimeout("chat-send");

        // Send the user's message to the gateway.
        const sendResult = await client.chatSend({
          message: outboundMessage,
          sessionKey,
          ...(scopedThinkingLevel ? { thinking: scopedThinkingLevel } : {}),
        });
        if (cancelled || done) return;
        activeRunId = asString(sendResult.runId);
        gatewaySentAt = Date.now();
        publishAgentModeDiagnostic({
          scope: "api-chat",
          event: "gateway.chat-send.complete",
          sessionId: diagnosticSessionId,
          detail: {
            activeRunId,
            elapsedMs: gatewaySentAt - requestStartedAt,
            thinking: scopedThinkingLevel ?? null,
          },
        });
        enqueueData({
          type: "gateway_send_ack",
          runId: activeRunId,
          sessionKey,
          elapsedMs: gatewaySentAt - requestStartedAt,
        });
        startHistoryPolling();
      } catch (err) {
        if (client) client.off("*", chatHandler);
        releaseHeldClient();
        const msg = err instanceof Error ? err.message : String(err);
        publishAgentModeDiagnostic({
          scope: "api-chat",
          event: "gateway.chat-send.error",
          sessionId: diagnosticSessionId,
          detail: { message: msg, elapsedMs: Date.now() - requestStartedAt },
        });
        console.error("[api/chat] chat.send failed:", msg);
        if (!cancelled && !done) {
          fullAssistantText += `\n\nError: Gateway error: ${msg}`;
          enqueueProgress("run_error", { error: msg });
          enqueueData({
            choices: [{ delta: { content: `\n\nError: Gateway error: ${msg}` } }],
          });
          await finishStream(true, null);
        }
      }
    };

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[api/chat] Error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    if (msg === "No runtime configured") {
      return Response.json(
        { error: "No runtime configured. Connect an OpenClaw Gateway in Settings." },
        { status: 503 }
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
