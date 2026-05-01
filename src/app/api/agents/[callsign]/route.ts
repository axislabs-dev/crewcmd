import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canReadAgent, canUpdateAgent, getAgentAccessContext, normalizeVisibilityForCreation } from "@/lib/agent-access";
import { resolveAccessibleWorkspace } from "@/lib/workspace";
import { logAudit, saveConfigVersion } from "@/lib/governance";
import { pushSkillToRuntime } from "@/lib/push-skill-to-runtime";
import { assessAgentModelSelection } from "@/lib/model-profiles";
import type { RuntimeCapabilitySnapshot } from "@/lib/runtime-capabilities";
import { syncAgentModelToRuntime } from "@/lib/runtime-agent-model-sync";
import { resolveAgent } from "@/lib/resolve-agent";

export const dynamic = "force-dynamic";
interface RouteParams { params: Promise<{ callsign: string }>; }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  if (!db) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  try {
    const access = await getAgentAccessContext();
    const workspace = await resolveAccessibleWorkspace({ request: _request });
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    let readable = canReadAgent(agent, access);
    if (!readable && workspace) {
      const [grant] = await withRetry(() =>
        db!
          .select({ id: schema.agentWorkspaceGrants.id })
          .from(schema.agentWorkspaceGrants)
          .where(
            and(
              eq(schema.agentWorkspaceGrants.agentId, agent.id),
              eq(schema.agentWorkspaceGrants.workspaceId, workspace.id)
            )
          )
          .limit(1)
      );
      readable = !!grant;
    }

    if (!readable) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    const resolvedAgent = await resolveAgent(agent.callsign);
    const heartbeats = await withRetry(() => db!.select().from(schema.agentHeartbeats)).catch(() => []);
    const hb = heartbeats.find((h) => (h.callsign ?? "").toLowerCase() === callsign.toLowerCase());
    const runtimeCapabilities = await loadRuntimeCapabilities(agent.runtimeId ?? null);
    const operatingLayer =
      agent.runtimeConfig && typeof agent.runtimeConfig === "object" && !Array.isArray(agent.runtimeConfig)
        ? (((agent.runtimeConfig as Record<string, unknown>).operatingLayer as Record<string, unknown> | undefined) ?? null)
        : null;
    const modelAssessment = assessAgentModelSelection(
      {
        model: agent.model ?? null,
        modelProfile: typeof operatingLayer?.modelProfile === "string" ? operatingLayer.modelProfile : null,
        fallbackProfiles: Array.isArray(operatingLayer?.fallbackProfiles)
          ? operatingLayer.fallbackProfiles.filter((value): value is string => typeof value === "string")
          : [],
        rolePack: typeof operatingLayer?.rolePack === "string" ? operatingLayer.rolePack : agent.role,
      },
      runtimeCapabilities
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
      companyId: agent.companyId,
      runtimeId: agent.runtimeId,
      ownerType: agent.ownerType,
      ownerUserId: agent.ownerUserId,
      ownerCompanyId: agent.ownerCompanyId,
      visibility: agent.visibility,
      role: agent.role ?? "engineer",
      model: agent.model ?? null,
      effectiveModel: resolvedAgent?.effectiveModel ?? agent.model ?? null,
      modelDefaultSource: resolvedAgent?.modelDefaultSource ?? (agent.model ? "agent_override" : "unresolved"),
      workspacePath: agent.workspacePath ?? null,
      canvasPosition: agent.canvasPosition ?? null,
      tokenUsage: hb?.rawData ? (hb.rawData as Record<string, unknown>)?.tokenUsage ?? null : null,
      modelAssessment,
    });
  } catch (err) {
    console.error("[api/agents/callsign] Error:", err);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });
  try {
    const access = await getAgentAccessContext();
    const body = await request.json();
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!canUpdateAgent(agent, access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const allowedFields = [
      "name", "callsign", "title", "emoji", "color", "adapterType", "adapterConfig", "runtimeConfig", "role", "model",
      "workspacePath", "reportsTo", "companyId", "soulContent", "status", "canvasPosition", "avatarUrl", "runtimeId",
    ] as const;
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) if (field in body) updates[field] = body[field];

    if ("visibility" in body) {
      updates.visibility = normalizeVisibilityForCreation({ ownerType: agent.ownerType, requestedVisibility: body.visibility });
    }

    const extendedAdapterFields = ["command","thinkingEffort","promptTemplate","instructionsFile","extraArgs","envVars","timeoutSec","gracePeriodSec","gatewayUrl","gatewayToken","httpUrl","httpAuthHeader"];
    if (extendedAdapterFields.some((f) => f in body)) {
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
      if ("gatewayToken" in body) merged.headers = { ...(merged.headers as Record<string, string> || {}), "x-openclaw-token": body.gatewayToken };
      if ("httpUrl" in body) merged.url = body.httpUrl;
      if ("httpAuthHeader" in body) merged.headers = { ...(merged.headers as Record<string, string> || {}), Authorization: body.httpAuthHeader };
      updates.adapterConfig = merged;
    }

    const extendedRuntimeFields = ["heartbeatEnabled","heartbeatIntervalSec","wakeOnDemand","cooldownSec","maxConcurrentRuns"];
    if (extendedRuntimeFields.some((f) => f in body)) {
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

    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    const [updated] = await withRetry(() => db!.update(schema.agents).set(updates).where(eq(schema.agents.id, agent.id)).returning());

    if (typeof updates.model === "string" && updated?.runtimeId && updated.runtimeRef) {
      const fallbackModels = Array.isArray((body.modelAssessment?.fallbackModels ?? null))
        ? body.modelAssessment.fallbackModels.filter((value: unknown): value is string => typeof value === "string")
        : [];

      await syncAgentModelToRuntime({
        runtimeId: updated.runtimeId,
        runtimeRef: updated.runtimeRef,
        primaryModel: updates.model,
        fallbackModels,
      }).catch((err) => {
        console.warn(
          `[api/agents/callsign] Failed to sync runtime model for ${updated.callsign}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
    }

    if (updates.runtimeConfig && updated) {
      const configCompanyId = updated.companyId ?? updated.ownerCompanyId ?? null;
      if (configCompanyId) {
        await saveConfigVersion(
          configCompanyId,
          "agent_runtime_config",
          updated.id,
          (updated.runtimeConfig ?? {}) as Record<string, unknown>,
          access.userId ?? "system",
          "Updated CrewCmd operating layer"
        ).catch(() => null);
        await logAudit(
          configCompanyId,
          access.userId ?? "system",
          "updated",
          "agent_runtime_config",
          updated.id,
          { callsign: updated.callsign }
        ).catch(() => null);
      }

      if (updated.runtimeId) {
        await pushSkillToRuntime(updated.runtimeId).catch((err) => {
          console.warn(
            `[api/agents/callsign] Failed to resync runtime skills after config update: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/agents/callsign] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

async function loadRuntimeCapabilities(runtimeId: string | null): Promise<RuntimeCapabilitySnapshot | null> {
  if (!runtimeId || !db) return null;
  const [runtime] = await withRetry(() =>
    db!
      .select({ metadata: schema.companyRuntimes.metadata })
      .from(schema.companyRuntimes)
      .where(eq(schema.companyRuntimes.id, runtimeId))
      .limit(1)
  );
  const metadata =
    runtime?.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
      ? (runtime.metadata as Record<string, unknown>)
      : null;
  const snapshot = metadata?.capabilitySnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot as RuntimeCapabilitySnapshot;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });
  try {
    const access = await getAgentAccessContext();
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!canUpdateAgent(agent, access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await withRetry(() => db!.delete(schema.agents).where(eq(schema.agents.id, agent.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/agents/callsign] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
