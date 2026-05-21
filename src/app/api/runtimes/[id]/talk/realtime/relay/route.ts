import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime, holdClient, releaseClient } from "@/lib/gateway-chat-pool";
import type { GatewayClient } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RelayAction = "audio" | "cancelOutput" | "mark" | "toolCall" | "toolResult" | "stop";

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
      const toolCall = await client.realtimeClientToolCall(params);
      const runId = firstString(toolCall.runId, toolCall.idempotencyKey);
      if (!runId) throw new Error("OpenClaw realtime tool call did not return a run id");

      await client.realtimeRelayToolResult({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: buildRealtimeToolWorkingResult(),
        options: { willContinue: true },
      });

      const text = await waitForChatFinal(client, runId);
      const result = await client.realtimeRelayToolResult({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: { result: text },
      });
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

function waitForChatFinal(client: GatewayClient, runId: string, timeoutMs = 110_000) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for OpenClaw realtime tool result"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      client.off("*", onEvent);
    };

    const onEvent = (payload: unknown) => {
      const event = asRecord(payload);
      if (!event) return;
      const runIds = extractEventRunIds(event);
      if (!runIds.includes(runId)) return;

      const state = firstString(event.state, event.status)?.toLowerCase();
      if (state === "final" || state === "complete" || state === "completed") {
        const text = extractText(event.message ?? event);
        cleanup();
        resolve(text || "OpenClaw completed without returning text.");
        return;
      }

      if (state === "aborted" || state === "error" || state === "failed") {
        const message = firstString(event.errorMessage, event.error, event.message) ??
          "OpenClaw realtime tool call failed";
        cleanup();
        reject(new Error(message));
      }
    };

    client.on("*", onEvent);
  });
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
  const direct = firstString(record.text, record.content, record.output, record.result);
  if (direct) return direct;

  return [
    record.message,
    record.delta,
    record.data,
    record.payload,
    record.parts,
    record.items,
  ].map((item) => extractText(item, seen)).filter(Boolean).join("");
}
