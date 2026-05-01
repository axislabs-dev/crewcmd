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
      console.error(`[api/chat] Failed to recover chat history for ${sessionKey}:`, error);
    }
  }

  return "";
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
    const outboundMessage = buildDelegatedAgentMessage({
      message: lastUserMessage.content,
      targetAgent,
    });
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

    const enqueueData = (payload: unknown) => {
      if (!streamController || done) return;
      try {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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
      if (fullAssistantText || !client) return;
      const recovered = await recoverAssistantTextFromGateway({
        client,
        allowedSessions: allowedEventSessions,
        currentUserContents: [lastUserMessage.content, outboundMessage],
        previousAssistantContents,
      });
      if (!recovered) return;

      fullAssistantText = recovered;
      lastStreamedText = recovered;

      if (streamController && !done) {
        const chunk = JSON.stringify({
          choices: [{ delta: { content: recovered } }],
        });
        streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
    };

    const finishStream = async (interrupted: boolean) => {
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
      await recoverMissingAssistantText();
      await persistAssistant(interrupted);
      done = true;
      try {
        streamController?.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController?.close();
      } catch { /* already closed */ }
      if (client) client.off("chat", chatHandler);
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

        // Send user message meta event with DB ID
        if (userMessageId) {
          enqueueData({ type: "meta", messageId: userMessageId, role: "user" });
        }
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
        if (client) {
          client.chatAbort({ sessionKey }).catch((err) => {
            console.error("[api/chat] chat.abort failed:", err);
          });
        }
        void persistAssistant(true);
        for (const fn of cleanupFns) fn();
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
      armInactivityTimeout(`gateway-${state || "event"}`);
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

      if (state === "delta") {
        const fullText = extractText(p.message || p);
        if (fullText && fullText.length > lastStreamedText.length) {
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
          const newContent = fullText.slice(lastStreamedText.length);
          lastStreamedText = fullText;
          fullAssistantText = fullText;

          const chunk = JSON.stringify({
            choices: [{ delta: { content: newContent } }],
          });
          streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
      } else if (state === "final") {
        const finalText = extractText(p.message || p);
        if (finalText && finalText.length > lastStreamedText.length) {
          const remaining = finalText.slice(lastStreamedText.length);
          const chunk = JSON.stringify({
            choices: [{ delta: { content: remaining } }],
          });
          streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        if (finalText) fullAssistantText = finalText;

        // Persist the complete assistant response
        finishStream(false);
      } else if (state === "aborted") {
        finishStream(true);
      } else if (state === "error") {
        const errorMsg = (p.errorMessage as string) || "Chat error";
        const chunk = JSON.stringify({
          choices: [{ delta: { content: `\n\nError: ${errorMsg}` } }],
        });
        streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        fullAssistantText += `\n\nError: ${errorMsg}`;

        finishStream(true);
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

        client.on("chat", chatHandler);
        cleanupFns.push(() => {
          client?.off("chat", chatHandler);
        });

        // Close only idle streams; active long-running turns reset this on gateway events.
        armInactivityTimeout("chat-send");

        // Send the user's message to the gateway.
        const sendResult = await client.chatSend({
          message: outboundMessage,
          sessionKey,
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
          },
        });
        enqueueData({
          type: "gateway_send_ack",
          runId: activeRunId,
          sessionKey,
          elapsedMs: gatewaySentAt - requestStartedAt,
        });
      } catch (err) {
        if (client) client.off("chat", chatHandler);
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
          enqueueData({
            choices: [{ delta: { content: `\n\nError: Gateway error: ${msg}` } }],
          });
          await finishStream(true);
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
