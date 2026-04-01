import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    // Find agent in DB by callsign (case-insensitive via uppercase match)
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Try to merge heartbeat data if available
    const heartbeats = await withRetry(() =>
      db!.select().from(schema.agentHeartbeats)
    ).catch(() => []);
    const hb = heartbeats.find(
      (h) => (h.callsign ?? "").toLowerCase() === callsign.toLowerCase()
    );

    return NextResponse.json({
      id: agent.id,
      callsign: agent.callsign,
      name: agent.name,
      title: agent.title,
      emoji: agent.emoji,
      color: agent.color,
      status: hb?.status ?? agent.status ?? "offline",
      currentTask: hb?.currentTask ?? agent.currentTask ?? null,
      lastActive: hb?.lastActive?.toISOString() ?? agent.lastActive?.toISOString() ?? new Date().toISOString(),
      reportsTo: agent.reportsTo,
      soulContent: agent.soulContent,
      adapterType: agent.adapterType,
      adapterConfig: agent.adapterConfig ?? {},
      runtimeConfig: agent.runtimeConfig ?? {},
      role: agent.role ?? "engineer",
      model: agent.model ?? null,
      workspacePath: agent.workspacePath ?? null,
      canvasPosition: agent.canvasPosition ?? null,
      tokenUsage: hb?.rawData ? (hb.rawData as Record<string, unknown>)?.tokenUsage ?? null : null,
    });
  } catch (err) {
    console.error("[api/agents/callsign] Error:", err);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();

    // Find the agent first
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Build update object from allowed fields
    const allowedFields = [
      "name", "callsign", "title", "emoji", "color",
      "adapterType", "adapterConfig", "runtimeConfig", "role", "model",
      "workspacePath", "reportsTo", "companyId", "soulContent", "status",
      "canvasPosition",
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Handle extended fields that merge into adapterConfig
    const extendedAdapterFields = [
      "command", "thinkingEffort", "promptTemplate", "instructionsFile",
      "extraArgs", "envVars", "timeoutSec", "gracePeriodSec",
      "gatewayUrl", "gatewayToken", "httpUrl", "httpAuthHeader",
    ];
    const hasExtendedAdapter = extendedAdapterFields.some((f) => f in body);
    if (hasExtendedAdapter) {
      const existing = (agent.adapterConfig ?? {}) as Record<string, unknown>;
      const merged = { ...existing, ...(updates.adapterConfig as Record<string, unknown> || {}) };
      if ("command" in body) merged.command = body.command || undefined;
      if ("thinkingEffort" in body) merged.thinkingEffort = body.thinkingEffort || undefined;
      if ("promptTemplate" in body) merged.promptTemplate = body.promptTemplate || undefined;
      if ("instructionsFile" in body) merged.instructionsFile = body.instructionsFile || undefined;
      if ("extraArgs" in body) merged.extraArgs = body.extraArgs || undefined;
      if ("envVars" in body) merged.envVars = body.envVars && Object.keys(body.envVars).length > 0 ? body.envVars : undefined;
      if ("timeoutSec" in body) merged.timeoutSec = body.timeoutSec;
      if ("gracePeriodSec" in body) merged.gracePeriodSec = body.gracePeriodSec;
      if ("gatewayUrl" in body) merged.url = body.gatewayUrl;
      if ("gatewayToken" in body) {
        merged.headers = { ...(merged.headers as Record<string, string> || {}), "x-openclaw-token": body.gatewayToken };
      }
      if ("httpUrl" in body) merged.url = body.httpUrl;
      if ("httpAuthHeader" in body) {
        merged.headers = { ...(merged.headers as Record<string, string> || {}), Authorization: body.httpAuthHeader };
      }
      updates.adapterConfig = merged;
    }

    // Handle extended heartbeat / run policy fields that merge into runtimeConfig
    const extendedRuntimeFields = [
      "heartbeatEnabled", "heartbeatIntervalSec", "wakeOnDemand", "cooldownSec", "maxConcurrentRuns",
    ];
    const hasExtendedRuntime = extendedRuntimeFields.some((f) => f in body);
    if (hasExtendedRuntime) {
      const existing = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
      const existingHb = (existing.heartbeat ?? {}) as Record<string, unknown>;
      const merged = { ...existing, ...(updates.runtimeConfig as Record<string, unknown> || {}) };
      merged.heartbeat = {
        enabled: "heartbeatEnabled" in body ? body.heartbeatEnabled : existingHb.enabled ?? false,
        intervalSec: "heartbeatIntervalSec" in body ? body.heartbeatIntervalSec : existingHb.intervalSec ?? 300,
        wakeOnDemand: "wakeOnDemand" in body ? body.wakeOnDemand : existingHb.wakeOnDemand ?? true,
        cooldownSec: "cooldownSec" in body ? body.cooldownSec : existingHb.cooldownSec ?? 60,
        maxConcurrentRuns: "maxConcurrentRuns" in body ? body.maxConcurrentRuns : existingHb.maxConcurrentRuns ?? 1,
      };
      updates.runtimeConfig = merged;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Use raw SQL set for dynamic updates via Drizzle
    const [updated] = await withRetry(() =>
      db!
        .update(schema.agents)
        .set(updates)
        .where(eq(schema.agents.id, agent.id))
        .returning()
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/agents/callsign] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    await withRetry(() =>
      db!.delete(schema.agents).where(eq(schema.agents.id, agent.id))
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/agents/callsign] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
