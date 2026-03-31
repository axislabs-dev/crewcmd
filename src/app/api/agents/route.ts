import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    return NextResponse.json({ agents: [], source: "none" });
  }

  try {
    // Fetch DB agents and heartbeats in parallel
    const [dbAgents, heartbeats] = await Promise.all([
      withRetry(() => db!.select().from(schema.agents)),
      withRetry(() => db!.select().from(schema.agentHeartbeats)).catch(() => []),
    ]);

    // Index heartbeats by callsign for quick lookup
    const heartbeatMap = new Map(
      heartbeats.map((hb) => [hb.callsign?.toLowerCase(), hb])
    );

    const agents = dbAgents.map((agent) => {
      const hb = heartbeatMap.get(agent.callsign.toLowerCase());

      return {
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
        tokenUsage: hb?.rawData ? (hb.rawData as Record<string, unknown>)?.tokenUsage ?? null : null,
      };
    });

    return NextResponse.json({
      agents,
      source: agents.length > 0 ? "db" : "none",
    });
  } catch (err) {
    console.error("[api/agents] Error:", err);
    return NextResponse.json({ agents: [], source: "none" });
  }
}

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const {
      name,
      callsign,
      title,
      emoji,
      color,
      adapterType,
      adapterConfig,
      runtimeConfig,
      role,
      model,
      workspacePath,
      reportsTo,
      companyId,
      // New extended fields (merged into adapterConfig / runtimeConfig)
      command,
      thinkingEffort,
      promptTemplate,
      instructionsFile,
      extraArgs,
      envVars,
      timeoutSec,
      gracePeriodSec,
      gatewayUrl,
      gatewayToken,
      httpUrl,
      httpAuthHeader,
      heartbeatEnabled,
      heartbeatIntervalSec,
      wakeOnDemand,
      cooldownSec,
      maxConcurrentRuns,
    } = body;

    if (!name || !callsign) {
      return NextResponse.json({ error: "name and callsign are required" }, { status: 400 });
    }

    // Build adapter config: start with any raw adapterConfig passed, then merge extended fields
    const finalAdapterConfig: Record<string, unknown> = { ...(adapterConfig || {}) };
    if (command) finalAdapterConfig.command = command;
    if (thinkingEffort) finalAdapterConfig.thinkingEffort = thinkingEffort;
    if (promptTemplate) finalAdapterConfig.promptTemplate = promptTemplate;
    if (instructionsFile) finalAdapterConfig.instructionsFile = instructionsFile;
    if (extraArgs) finalAdapterConfig.extraArgs = extraArgs;
    if (envVars && Object.keys(envVars).length > 0) finalAdapterConfig.envVars = envVars;
    if (timeoutSec !== undefined) finalAdapterConfig.timeoutSec = timeoutSec;
    if (gracePeriodSec !== undefined) finalAdapterConfig.gracePeriodSec = gracePeriodSec;
    // Gateway-specific
    if (gatewayUrl) finalAdapterConfig.url = gatewayUrl;
    if (gatewayToken) finalAdapterConfig.headers = { ...(finalAdapterConfig.headers as Record<string, string> || {}), "x-openclaw-token": gatewayToken };
    // HTTP-specific
    if (httpUrl) finalAdapterConfig.url = httpUrl;
    if (httpAuthHeader) finalAdapterConfig.headers = { ...(finalAdapterConfig.headers as Record<string, string> || {}), Authorization: httpAuthHeader };

    // Build runtime config
    const finalRuntimeConfig: Record<string, unknown> = { ...(runtimeConfig || {}) };
    if (heartbeatEnabled !== undefined || heartbeatIntervalSec !== undefined || wakeOnDemand !== undefined || cooldownSec !== undefined || maxConcurrentRuns !== undefined) {
      finalRuntimeConfig.heartbeat = {
        enabled: heartbeatEnabled ?? false,
        intervalSec: heartbeatIntervalSec ?? 300,
        wakeOnDemand: wakeOnDemand ?? true,
        cooldownSec: cooldownSec ?? 60,
        maxConcurrentRuns: maxConcurrentRuns ?? 1,
      };
    }

    const [created] = await withRetry(() =>
      db!.insert(schema.agents).values({
        name,
        callsign: callsign.toUpperCase(),
        title: title || "Agent",
        emoji: emoji || "\u{1F916}",
        color: color || "#888888",
        adapterType: adapterType || "openclaw_gateway",
        adapterConfig: finalAdapterConfig,
        runtimeConfig: finalRuntimeConfig,
        role: role || "engineer",
        model: model || null,
        workspacePath: workspacePath || null,
        reportsTo: reportsTo || null,
        companyId: companyId || null,
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/agents] POST Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "An agent with that callsign already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
