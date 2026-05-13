import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import {
  canManageCompanyOwnedAgent,
  getAgentAccessContext,
  normalizeVisibilityForCreation,
  resolveRuntimeOwnership,
} from "@/lib/agent-access";
import {
  RUNTIME_CLASSES,
  SCOPE_TYPES,
  assertRuntimeAllowedForScope,
  type Scope,
  type RuntimeBindingTarget,
} from "@/lib/collaboration-policy";
import {
  getAgentWorkspaceIds,
  grantAgentDefaultWorkspace,
  grantAgentToWorkspace,
  isHeartbeatBearerRequest,
  listWorkspaceAgents,
  resolveAccessibleWorkspace,
  type WorkspaceRecord,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ agents: [], source: "none" });
  }

  try {
    const isHeartbeatBearer = await isHeartbeatBearerRequest(request);
    const requestedCompanyId =
      request.nextUrl.searchParams.get("companyId") ??
      request.nextUrl.searchParams.get("company_id");
    const requestedWorkspaceId = request.nextUrl.searchParams.get("workspaceId");
    const runtimeId = request.nextUrl.searchParams.get("runtimeId");

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: requestedWorkspaceId,
      explicitCompanyId: requestedCompanyId,
      requireExplicitForBearer: true,
    });

    if (!workspace) {
      if (isHeartbeatBearer && !requestedCompanyId && !requestedWorkspaceId) {
        return NextResponse.json(
          { error: "workspaceId or companyId is required for bearer-scoped agent listing" },
          { status: 400 }
        );
      }
      return NextResponse.json({ agents: [], source: "none" });
    }

    const runtimeOwnership = await resolveRuntimeOwnership(runtimeId || null);
    if (runtimeOwnership) {
      assertRuntimeAllowedForScope(runtimeBindingTarget(runtimeId!, runtimeOwnership), workspaceScope(workspace));
    }

    const includeDetached = request.nextUrl.searchParams.get("includeDetached") === "true";

    const [dbAgents, heartbeats] = await Promise.all([
      listWorkspaceAgents(workspace.id, { runtimeId, includeDetached }),
      withRetry(() => db!.select().from(schema.agentHeartbeats)).catch(() => []),
    ]);

    const heartbeatMap = new Map(heartbeats.map((hb) => [hb.callsign?.toLowerCase(), hb]));

    const agents = await Promise.all(dbAgents.map(async (agent) => {
      const hb = heartbeatMap.get(agent.callsign.toLowerCase());
      const workspaceIds = await getAgentWorkspaceIds(agent.id);
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
        provider: agent.provider ?? null,
        adapterConfig: agent.adapterConfig ?? {},
        runtimeConfig: agent.runtimeConfig ?? {},
        role: agent.role ?? "engineer",
        model: agent.model ?? null,
        workspacePath: agent.workspacePath ?? null,
        canvasPosition: agent.canvasPosition ?? null,
        avatarUrl: agent.avatarUrl ?? null,
        runtimeId: agent.runtimeId ?? null,
        runtimeRef: agent.runtimeRef ?? null,
        ownerType: agent.ownerType,
        ownerUserId: agent.ownerUserId ?? null,
        ownerCompanyId: agent.ownerCompanyId ?? null,
        visibility: agent.visibility,
        workspaceIds,
        tokenUsage: hb?.rawData ? (hb.rawData as Record<string, unknown>)?.tokenUsage ?? null : null,
      };
    }));

    return NextResponse.json({ agents, source: agents.length > 0 ? "db" : "none" });
  } catch (err) {
    console.error("[api/agents] Error:", err);
    if (err instanceof Error && err.name === "PolicyViolation") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ agents: [], source: "none" });
  }
}

export async function POST(request: NextRequest) {
  const { requireAuth } = await import("@/lib/require-auth");
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

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
      provider,
      role,
      model,
      workspacePath,
      reportsTo,
      companyId,
      workspaceId,
      runtimeId,
      ownerType,
      visibility,
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
      openrouterApiKey,
      openrouterBaseUrl,
      heartbeatEnabled,
      heartbeatIntervalSec,
      wakeOnDemand,
      cooldownSec,
      maxConcurrentRuns,
    } = body;

    if (!name || !callsign) {
      return NextResponse.json({ error: "name and callsign are required" }, { status: 400 });
    }

    const targetWorkspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? access.activeCompanyId ?? null,
    });

    if (!targetWorkspace) {
      return NextResponse.json({ error: "A readable workspace is required" }, { status: 400 });
    }

    const runtimeOwnership = await resolveRuntimeOwnership(runtimeId || null);
    if (runtimeOwnership) {
      assertRuntimeAllowedForScope(runtimeBindingTarget(runtimeId, runtimeOwnership), workspaceScope(targetWorkspace));
    }

    const effectiveOwnerType = runtimeOwnership?.ownerType ?? (ownerType === "company" ? "company" : "user");
    const effectiveOwnerCompanyId = runtimeOwnership?.ownerCompanyId ?? (effectiveOwnerType === "company" ? access.activeCompanyId : null);
    const effectiveOwnerUserId = runtimeOwnership?.ownerUserId ?? (effectiveOwnerType === "user" ? access.userId : null);

    if (effectiveOwnerType === "company" && !canManageCompanyOwnedAgent(access, effectiveOwnerCompanyId)) {
      return NextResponse.json({ error: "Only company admins can create org-owned agents" }, { status: 403 });
    }

    const finalAdapterConfig: Record<string, unknown> = { ...(adapterConfig || {}) };
    if (command) finalAdapterConfig.command = command;
    if (thinkingEffort) finalAdapterConfig.thinkingEffort = thinkingEffort;
    if (promptTemplate) finalAdapterConfig.promptTemplate = promptTemplate;
    if (instructionsFile) finalAdapterConfig.instructionsFile = instructionsFile;
    if (extraArgs) finalAdapterConfig.extraArgs = extraArgs;
    if (envVars && Object.keys(envVars).length > 0) finalAdapterConfig.envVars = envVars;
    if (timeoutSec !== undefined) finalAdapterConfig.timeoutSec = timeoutSec;
    if (gracePeriodSec !== undefined) finalAdapterConfig.gracePeriodSec = gracePeriodSec;
    if (gatewayUrl) finalAdapterConfig.url = gatewayUrl;
    if (gatewayToken) finalAdapterConfig.headers = { ...(finalAdapterConfig.headers as Record<string, string> || {}), "x-openclaw-token": gatewayToken };
    if (httpUrl) finalAdapterConfig.url = httpUrl;
    if (httpAuthHeader) finalAdapterConfig.headers = { ...(finalAdapterConfig.headers as Record<string, string> || {}), Authorization: httpAuthHeader };
    if (openrouterApiKey) finalAdapterConfig.apiKey = openrouterApiKey;
    if (openrouterBaseUrl) finalAdapterConfig.baseUrl = openrouterBaseUrl;
    else if (adapterType === "openrouter") finalAdapterConfig.baseUrl = "https://openrouter.ai/api/v1";

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
        emoji: emoji || "🤖",
        color: color || "#888888",
        adapterType: adapterType || "openclaw_gateway",
        adapterConfig: finalAdapterConfig,
        runtimeConfig: finalRuntimeConfig,
        provider: provider || null,
        role: role || "engineer",
        model: model || null,
        workspacePath: workspacePath || null,
        reportsTo: reportsTo || null,
        companyId: targetWorkspace.companyId ?? companyId ?? access.activeCompanyId ?? null,
        runtimeId: runtimeId || null,
        ownerType: effectiveOwnerType,
        ownerUserId: effectiveOwnerUserId,
        ownerCompanyId: effectiveOwnerCompanyId,
        visibility: normalizeVisibilityForCreation({ ownerType: effectiveOwnerType, requestedVisibility: visibility }),
      }).returning()
    );

    await grantAgentDefaultWorkspace({
      agentId: created.id,
      ownerType: effectiveOwnerType,
      ownerUserId: effectiveOwnerUserId,
      ownerCompanyId: effectiveOwnerCompanyId,
      fallbackCompanyId: targetWorkspace.companyId,
      grantedBy: access.userId,
    });

    await grantAgentToWorkspace({
      agentId: created.id,
      workspaceId: targetWorkspace.id,
      accessLevel: effectiveOwnerType === "company" ? "operator" : "manager",
      grantedBy: access.userId,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/agents] POST Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "An agent with that callsign already exists" }, { status: 409 });
    }
    if (err instanceof Error && err.name === "PolicyViolation") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}

function runtimeBindingTarget(
  id: string,
  runtime: Awaited<ReturnType<typeof resolveRuntimeOwnership>>,
): RuntimeBindingTarget {
  return {
    id,
    class: runtime?.ownerType === "company" ? RUNTIME_CLASSES.SHARED : RUNTIME_CLASSES.PERSONAL,
    ownerUserId: runtime?.ownerUserId ?? null,
  };
}

function workspaceScope(workspace: WorkspaceRecord): Scope {
  return workspace.type === "personal"
    ? {
        id: workspace.id,
        type: SCOPE_TYPES.PRIVATE_USER,
        ownerUserId: workspace.ownerUserId ?? undefined,
      }
    : {
        id: workspace.id,
        type: SCOPE_TYPES.ORG,
      };
}
