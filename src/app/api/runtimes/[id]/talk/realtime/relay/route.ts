import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatSessions, companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { canAccessChatSession } from "@/lib/chat-session-access";
import { publishChatProgressEvent } from "@/lib/chat-pubsub";
import { persistChatProgressEvent } from "@/lib/chat-session-events";
import { isAssistantDeliveryPlaceholder, selectRecoveredAssistantText } from "@/lib/chat-recovery";
import { getGatewayClientForRuntime, holdClient, releaseClient } from "@/lib/gateway-chat-pool";
import type { GatewayClient } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";
export const maxDuration = 620;

const REALTIME_TOOL_RESULT_TIMEOUT_MS = 10 * 60_000;
const REALTIME_HISTORY_POLL_INTERVAL_MS = 5_000;
const REALTIME_EMPTY_FINAL_HISTORY_GRACE_MS = 30_000;

type RelayAction = "audio" | "cancelOutput" | "mark" | "toolCall" | "toolResult" | "stop";

type ChatProgressEventName =
  | "run_started"
  | "tool_started"
  | "tool_updated"
  | "tool_completed"
  | "run_completed"
  | "run_error";

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
    detailKind?: "input" | "output" | "status";
    detailTruncated?: boolean;
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const { id } = await params;
    const access = await getAgentAccessContext();
    const readWhere = buildRuntimeReadWhere(access);
    if (!readWhere) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const [runtime] = await withRetry(() =>
      db!
        .select({ id: companyRuntimes.id })
        .from(companyRuntimes)
        .where(and(eq(companyRuntimes.id, id), readWhere))
        .limit(1)
    );
    if (!runtime) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const relaySessionId = readRequiredString(body.relaySessionId, "relaySessionId");
    const action = readRelayAction(body.action);
    const client = await getGatewayClientForRuntime(runtime.id);

    if (action === "audio") {
      const audioBase64 = readRequiredString(body.audioBase64, "audioBase64");
      const result = await client.realtimeRelayAudio({
        relaySessionId,
        audioBase64,
        timestamp: readOptionalNumber(body.timestamp),
      });
      return NextResponse.json({ result });
    }

    if (action === "mark") {
      const result = await client.realtimeRelayMark({
        relaySessionId,
        markName: readOptionalString(body.markName),
      });
      return NextResponse.json({ result });
    }

    if (action === "cancelOutput") {
      const result = await client.realtimeRelayCancelOutput(
        relaySessionId,
        readOptionalString(body.reason),
      );
      return NextResponse.json({ result });
    }

    if (action === "toolResult") {
      const callId = readRequiredString(body.callId, "callId");
      const result = await client.realtimeRelayToolResult({
        relaySessionId,
        callId,
        result: body.result ?? null,
      });
      return NextResponse.json({ result });
    }

    if (action === "toolCall") {
      const result = await runRealtimeToolCall(client, {
        request,
        relaySessionId,
        sessionKey: readRequiredString(body.sessionKey, "sessionKey"),
        callId: readRequiredString(body.callId, "callId"),
        name: readRequiredString(body.name, "name"),
        args: body.args,
      });
      return NextResponse.json({ result });
    }

    const result = await client.realtimeRelayStop(relaySessionId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

class ValidationError extends Error {}

async function runRealtimeToolCall(
  client: GatewayClient,
  params: {
    request: Request;
    relaySessionId: string;
    sessionKey: string;
    callId: string;
    name: string;
    args: unknown;
  },
) {
  if (params.name !== "openclaw_agent_consult") {
    const result = await client.realtimeRelayToolResult({
      relaySessionId: params.relaySessionId,
      callId: params.callId,
      result: {
        error: `Unsupported realtime tool call: ${params.name}`,
        name: params.name,
      },
    });
    return { delegated: false, result };
  }

  holdClient(client);
  try {
    try {
      const toolCall = await client.realtimeClientToolCall({
        relaySessionId: params.relaySessionId,
        sessionKey: params.sessionKey,
        callId: params.callId,
        name: params.name,
        args: params.args,
      });
      const runId = firstString(toolCall.runId, toolCall.idempotencyKey);
      if (!runId) throw new Error("OpenClaw realtime tool call did not return a run id");
      const audit = await createRealtimeAuditPublisher(params.request, params.sessionKey, runId);
      void audit.publish("run_started");

      await client.realtimeRelayToolResult({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: buildRealtimeToolWorkingResult(),
        options: { willContinue: true },
      });

      const text = await waitForChatFinal({
        client,
        runId,
        sessionKey: params.sessionKey,
        args: params.args,
        audit,
      });
      const result = await client.realtimeRelayToolResult({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: { result: text },
      });
      void audit.publish("run_completed");
      return { delegated: true, runId, result, finalText: text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw realtime tool call failed";
      await client.realtimeRelayToolResult({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: { error: message, name: params.name },
      }).catch(() => {});
      throw error;
    }
  } finally {
    releaseClient(client);
  }
}

function buildRealtimeToolWorkingResult() {
  return {
    status: "working",
    tool: "openclaw_agent_consult",
    message:
      "Tell the person briefly that you are checking, then wait for the final OpenClaw result before answering with the actual result.",
  };
}

function waitForChatFinal(params: {
  client: GatewayClient;
  runId: string;
  sessionKey: string;
  args: unknown;
  audit: RealtimeAuditPublisher;
  timeoutMs?: number;
}) {
  const {
    client,
    runId,
    sessionKey,
    args,
    audit,
    timeoutMs = REALTIME_TOOL_RESULT_TIMEOUT_MS,
  } = params;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let historyPollInFlight = false;
    let historyPollTimeout: ReturnType<typeof setTimeout> | null = null;
    let deferredFinalText: string | null = null;
    let deferredFinalDeadlineMs: number | null = null;
    let latestSourceReplyText: string | null = null;

    const timer = setTimeout(() => {
      void recoverFromHistory("timeout").then((recovered) => {
        if (recovered || settled) return;
        cleanup();
        void audit.publish("run_error", { error: "Timed out waiting for OpenClaw realtime tool result" });
        reject(new Error("Timed out waiting for OpenClaw realtime tool result"));
      });
    }, timeoutMs);

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      if (historyPollTimeout) clearTimeout(historyPollTimeout);
      historyPollTimeout = null;
      client.off("*", onEvent);
    };

    const resolveWithText = (text: string) => {
      cleanup();
      resolve(text);
    };

    const maybeResolveDeferredFinal = () => {
      if (settled || deferredFinalDeadlineMs === null || Date.now() < deferredFinalDeadlineMs) return false;
      resolveWithText(deferredFinalText ?? "OpenClaw completed without returning text.");
      return true;
    };

    const scheduleHistoryPoll = () => {
      if (settled || historyPollTimeout) return;
      historyPollTimeout = setTimeout(() => {
        historyPollTimeout = null;
        void recoverFromHistory("poll");
      }, REALTIME_HISTORY_POLL_INTERVAL_MS);
    };

    const recoverFromHistory = async (reason: string) => {
      if (settled || historyPollInFlight) return "";
      historyPollInFlight = true;
      try {
        const recovered = await recoverRealtimeConsultTextFromHistory({
          client,
          runId,
          sessionKey,
          args,
        });
        if (recovered && !settled) {
          resolveWithText(recovered);
          return recovered;
        }
        if (latestSourceReplyText && !settled) {
          resolveWithText(latestSourceReplyText);
          return latestSourceReplyText;
        }
        if (!maybeResolveDeferredFinal()) scheduleHistoryPoll();
        return "";
      } catch (error) {
        if (reason !== "poll") {
          console.error(`[api/realtime/relay] Failed to recover realtime consult text from history (${reason}):`, error);
        }
        if (!maybeResolveDeferredFinal()) scheduleHistoryPoll();
        return "";
      } finally {
        historyPollInFlight = false;
      }
    };

    const onEvent = (payload: unknown) => {
      const event = asRecord(payload);
      if (!event) return;
      const runIds = extractEventRunIds(event);
      if (!runIds.includes(runId)) return;

      const eventSourceReplyText = extractSourceReplyText(event);
      if (eventSourceReplyText) latestSourceReplyText = eventSourceReplyText;

      const toolProgress = extractToolProgress(event);
      if (toolProgress) void audit.publish(toolProgress.event, { activeTool: toolProgress.activeTool });

      const state = firstString(event.state, event.status)?.toLowerCase();
      if (isRealtimeConsultTerminalResultEvent(event, state, eventSourceReplyText)) {
        const text = extractSourceReplyText(event.message) || eventSourceReplyText || extractText(event.message) || extractText(event);
        if (text) {
          if (isRealtimeConsultPlaceholderText(text)) {
            if (latestSourceReplyText) {
              resolveWithText(latestSourceReplyText);
              return;
            }
            deferredFinalText = text;
            deferredFinalDeadlineMs ??= Date.now() + REALTIME_EMPTY_FINAL_HISTORY_GRACE_MS;
            void recoverFromHistory("placeholder-final");
            return;
          }
          resolveWithText(text);
          return;
        }
        deferredFinalText = "OpenClaw completed without returning text.";
        deferredFinalDeadlineMs ??= Date.now() + REALTIME_EMPTY_FINAL_HISTORY_GRACE_MS;
        void recoverFromHistory("empty-final");
        return;
      }

      if (state === "aborted" || state === "error" || state === "failed") {
        const message = firstString(event.errorMessage, event.error, event.message) ??
          "OpenClaw realtime tool call failed";
        void audit.publish("run_error", { error: message });
        cleanup();
        reject(new Error(message));
      }
    };

    client.on("*", onEvent);
    scheduleHistoryPoll();
  });
}

type RealtimeAuditPublisher = Awaited<ReturnType<typeof createRealtimeAuditPublisher>>;

async function createRealtimeAuditPublisher(request: Request, sessionKey: string, runId: string) {
  const startedAt = Date.now();
  const session = await resolveAuditSession(request, sessionKey);

  const publish = async (
    event: ChatProgressEventName,
    details: Partial<Pick<ChatProgressEvent, "error" | "activeTool">> = {},
  ) => {
    if (!session?.companyId) return;
    const payload: ChatProgressEvent = {
      type: "chat_progress",
      event,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      agentId: session.agentId,
      gatewayAgentId: session.agentId,
      sessionKey,
      runId,
      ...(details.error ? { error: details.error } : {}),
      ...(details.activeTool ? { activeTool: details.activeTool } : {}),
    };

    await persistChatProgressEvent({
      sessionId: session.id,
      companyId: session.companyId,
      agentId: session.agentId,
      gatewaySessionKey: sessionKey,
      payload,
    }).catch((error) => {
      console.error("[api/realtime/relay] Failed to persist realtime tool progress:", error);
    });

    publishChatProgressEvent({
      type: "chat_progress",
      sessionId: session.id,
      agentId: session.agentId,
      companyId: session.companyId,
      sessionKey,
      channelId: session.channelId,
      event,
      at: payload.at,
      payload: payload as unknown as Record<string, unknown>,
    });
  };

  return { publish };
}

async function resolveAuditSession(request: Request, sessionKey: string) {
  if (!db) return null;
  const sessions = await withRetry(() =>
    db!
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.gatewaySessionKey, sessionKey))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(10)
  );

  for (const session of sessions) {
    if (await canAccessChatSession(request as Parameters<typeof canAccessChatSession>[0], session)) return session;
  }
  return null;
}

async function recoverRealtimeConsultTextFromHistory(params: {
  client: Pick<GatewayClient, "chatHistory">;
  runId: string;
  sessionKey: string;
  args: unknown;
}) {
  const result = await params.client.chatHistory({ sessionKey: params.sessionKey, limit: 25 });
  const messages = extractHistoryMessages(result);
  if (messages.length === 0) return "";

  const byRunId = selectHistoryAssistantByRunId(messages, params.runId);
  if (byRunId) return byRunId;

  const consultMessage = buildRealtimeConsultChatMessage(params.args);
  if (consultMessage) {
    const recovered = selectRecoveredAssistantText({
      messages,
      currentUserContents: [consultMessage],
    });
    if (recovered && !isRealtimeConsultPlaceholderText(recovered)) return recovered;
  }

  const question = readRealtimeConsultQuestion(params.args);
  return question ? selectAssistantAfterMatchingQuestion(messages, question) : "";
}

type RealtimeHistoryMessage = {
  role: string | null;
  content: string;
  idempotencyKey: string | null;
};

function extractHistoryMessages(result: unknown): RealtimeHistoryMessage[] {
  const record = asRecord(result);
  const rawMessages = Array.isArray(record?.messages)
    ? record.messages
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(result)
        ? result
        : [];

  return rawMessages
    .map((item) => {
      const message = asRecord(item);
      const role = firstString(message?.role, message?.type, message?.author)?.toLowerCase() ?? null;
      const content = extractSourceReplyText(message) || extractText(message?.content ?? message?.message ?? message);
      const idempotencyKey = firstString(message?.idempotencyKey, message?.idempotency_key) ?? null;
      return { role, content, idempotencyKey };
    })
    .filter((message) => message.content);
}

function selectHistoryAssistantByRunId(messages: RealtimeHistoryMessage[], runId: string) {
  const recovered = messages.findLast((message) =>
    message.role === "assistant" &&
    message.content.trim() &&
    !isRealtimeConsultPlaceholderText(message.content) &&
    Boolean(
      message.idempotencyKey === runId ||
      message.idempotencyKey?.startsWith(`${runId}:`)
    )
  );
  return recovered?.content ?? "";
}

function buildRealtimeConsultChatMessage(args: unknown) {
  const record = readRealtimeConsultArgs(args);
  const question = readRealtimeConsultQuestion(record);
  if (!question) return "";

  return [
    question,
    firstString(record?.context) ? `Context:\n${firstString(record?.context)}` : null,
    firstString(record?.responseStyle) ? `Spoken style:\n${firstString(record?.responseStyle)}` : null,
  ].filter(Boolean).join("\n\n");
}

function isRealtimeConsultPlaceholderText(text: string) {
  if (isAssistantDeliveryPlaceholder(text)) return true;
  const normalized = normalizeHistoryText(text).replace(/[.!?]+$/g, "");
  const ascii = normalized.replace(/[’‘]/g, "'");
  const mentionsMissingResult = ascii.includes("the result didn't include") ||
    ascii.includes("the result did not include") ||
    ascii.includes("result didn't include") ||
    ascii.includes("result did not include") ||
    ascii.includes("just a completion status") ||
    ascii.includes("only a completion status") ||
    ascii.includes("completion status");
  const asksForInputAgain = ascii.includes("paste the readme") ||
    ascii.includes("share the readme text") ||
    ascii.includes("run the check again") ||
    ascii.includes("without the actual text") ||
    ascii.includes("without the actual content") ||
    ascii.includes("don't have the openclaw result") ||
    ascii.includes("do not have the openclaw result");
  return normalized === "done" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "ok" ||
    normalized === "okay" ||
    normalized === "all set" ||
    mentionsMissingResult ||
    asksForInputAgain;
}

function readRealtimeConsultQuestion(args: unknown) {
  const record = readRealtimeConsultArgs(args);
  return firstString(record?.question, record?.prompt, record?.query, record?.task);
}

function readRealtimeConsultArgs(args: unknown) {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      const record = asRecord(parsed);
      return record ?? { question: args };
    } catch {
      return { question: args };
    }
  }
  return asRecord(args);
}

function selectAssistantAfterMatchingQuestion(messages: RealtimeHistoryMessage[], question: string) {
  const normalizedQuestion = normalizeHistoryText(question);
  if (normalizedQuestion.length < 8) return "";

  const lastMatchingUserIndex = messages.findLastIndex((message) =>
    message.role === "user" &&
    historyTextMatchesQuestion(message.content, normalizedQuestion)
  );
  if (lastMatchingUserIndex < 0) return "";

  const recovered = messages
    .slice(lastMatchingUserIndex + 1)
    .find((message) =>
      message.role === "assistant" &&
      message.content.trim() &&
      !isRealtimeConsultPlaceholderText(message.content)
    );
  return recovered?.content ?? "";
}

function historyTextMatchesQuestion(content: string, normalizedQuestion: string) {
  const normalizedContent = normalizeHistoryText(content);
  if (!normalizedContent) return false;
  return normalizedContent === normalizedQuestion ||
    normalizedContent.includes(normalizedQuestion) ||
    (normalizedContent.length >= 8 && normalizedQuestion.includes(normalizedContent));
}

function isRealtimeConsultTerminalResultEvent(
  event: Record<string, unknown>,
  state: string | undefined,
  sourceReplyText: string,
) {
  if (state !== "final" && state !== "complete" && state !== "completed") return false;

  const eventName = firstString(event.event, event.type, event.kind)?.toLowerCase() ?? "";
  if (eventName.includes("tool") && !sourceReplyText) return false;
  if (eventName === "chat" || eventName === "trace.artifacts") return true;
  if (asRecord(event.message)) return true;
  if (sourceReplyText) return true;

  const data = asRecord(event.data) ?? asRecord(event.payload);
  return Array.isArray(data?.assistantTexts) || Array.isArray(event.assistantTexts);
}

function normalizeHistoryText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function readRequiredString(value: unknown, name: string) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new ValidationError(`${name} is required`);
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRelayAction(value: unknown): RelayAction {
  if (
    value === "audio" ||
    value === "cancelOutput" ||
    value === "mark" ||
    value === "toolCall" ||
    value === "toolResult" ||
    value === "stop"
  ) return value;
  throw new ValidationError("action must be audio, cancelOutput, mark, toolCall, toolResult, or stop");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function parseJsonRecord(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractSourceReplyText(value: unknown, seen = new WeakSet<object>()): string {
  if (!value) return "";

  if (typeof value === "string") {
    const parsed = parseJsonRecord(value);
    return parsed ? extractSourceReplyText(parsed, seen) : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractSourceReplyText(item, seen);
      if (text) return text;
    }
    return "";
  }

  const record = asRecord(value);
  if (!record) return "";
  if (seen.has(record)) return "";
  seen.add(record);

  const sourceReply = asRecord(record.sourceReply) ?? asRecord(record.source_reply);
  const direct = sourceReply
    ? firstString(sourceReply.text, sourceReply.message, sourceReply.content) || extractText(sourceReply)
    : firstString(record.sourceReplyText, record.source_reply_text);
  if (direct && !isRealtimeConsultPlaceholderText(direct)) return direct;

  for (const key of [
    "content",
    "text",
    "output",
    "result",
    "response",
    "data",
    "payload",
    "message",
    "details",
    "metadata",
    "__openclaw",
    "toolResult",
    "tool_result",
    "arguments",
    "args",
  ]) {
    const text = extractSourceReplyText(record[key], seen);
    if (text) return text;
  }

  return "";
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
  ]
    .map((value) => typeof value === "string" ? value : null)
    .filter((value): value is string => Boolean(value));
}

function stringifyToolDetail(value: unknown, maxLength = 8_000) {
  if (value === undefined || value === null) return null;

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }

  text = text.trim();
  if (!text) return null;

  return {
    detail: text.length > maxLength ? text.slice(0, maxLength) : text,
    detailTruncated: text.length > maxLength,
  };
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
  const detailKind: "input" | "output" = event === "tool_started" ? "input" : "output";
  const detailValue = event === "tool_started"
    ? data.args ?? data.arguments ?? data.input
    : data.partialResult ?? data.partial_result ?? data.result ?? data.output;
  const detail = stringifyToolDetail(detailValue);

  return {
    event,
    activeTool: {
      ...(toolCallId ? { id: toolCallId } : {}),
      name,
      status: phase,
      detailKind,
      ...(detail ? detail : {}),
    },
  };
}

function extractText(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item, seen)).filter(Boolean).join("");
  }

  const record = value as Record<string, unknown>;
  const direct = firstString(record.text, record.output, record.result, record.finalText);
  if (direct) return direct;

  return [
    record.content,
    record.message,
    record.delta,
    record.data,
    record.payload,
    record.parts,
    record.items,
    record.assistantTexts,
  ].map((item) => extractText(item, seen)).filter(Boolean).join("");
}
