import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agents, channelMembers, channels, companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

const REALTIME_SLOW_SPEECH_SILENCE_MS = 2000;
const REALTIME_SLOW_SPEECH_PREFIX_PADDING_MS = 500;
const CHANNEL_AGENT_SPEAKING_ROLES = new Set(["owner", "admin", "member", "contributor"]);
const CHANNEL_AGENT_ACTIVE_MODES = new Set(["proactive", "on_call"]);

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
    const channelId = readOptionalString(body.channelId);
    const channelAgentId = readOptionalString(body.channelAgentId) ?? readOptionalString(body.agentId);
    if (channelId) {
      const violation = await resolveRealtimeChannelAgentViolation({
        channelId,
        agentCallsign: channelAgentId,
      });
      if (violation) return NextResponse.json({ error: violation }, { status: 403 });
    }

    const client = await getGatewayClientForRuntime(runtime.id);
    const session = await client.realtimeTalkSession({
      transport: "gateway-relay",
      sessionKey: readOptionalString(body.sessionKey),
      provider: readOptionalString(body.provider),
      model: readOptionalString(body.model),
      voice: readOptionalString(body.voice),
      agentId: readOptionalString(body.agentId),
      vadThreshold: readOptionalNumber(body.vadThreshold),
      silenceDurationMs: readOptionalNumber(body.silenceDurationMs) ?? REALTIME_SLOW_SPEECH_SILENCE_MS,
      prefixPaddingMs: readOptionalNumber(body.prefixPaddingMs) ?? REALTIME_SLOW_SPEECH_PREFIX_PADDING_MS,
    });

    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function resolveRealtimeChannelAgentViolation(params: {
  channelId: string;
  agentCallsign?: string;
}) {
  const callsign = params.agentCallsign?.trim();
  if (!callsign) return "Channel agent mention is required.";

  const [channel] = await withRetry(() =>
    db!
      .select({ type: channels.type })
      .from(channels)
      .where(eq(channels.id, params.channelId))
      .limit(1)
  );
  if (!channel) return "Agent is not a member of this channel.";

  const [agent] = await withRetry(() =>
    db!
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.callsign, callsign))
      .limit(1)
  );
  if (!agent) return "Agent is not a member of this channel.";

  const [member] = await withRetry(() =>
    db!
      .select({
        role: channelMembers.role,
        agentParticipationMode: channelMembers.agentParticipationMode,
      })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, params.channelId),
        eq(channelMembers.memberType, "agent"),
        eq(channelMembers.agentId, agent.id),
      ))
      .limit(1)
  );

  if (!member) return "Agent is not a member of this channel.";
  if (!CHANNEL_AGENT_SPEAKING_ROLES.has(member.role)) {
    return "Agent cannot post in this channel.";
  }
  if (channel.type !== "dm" && !CHANNEL_AGENT_ACTIVE_MODES.has(member.agentParticipationMode ?? "mention_only")) {
    return "Agent is not an active participant in this channel.";
  }
  return null;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
