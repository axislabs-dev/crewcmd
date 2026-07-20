import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import {
  agentWorkspaceGrants,
  channelMembers,
  channels,
  companyRuntimes,
} from "@/db/schema";
import {
  canManageCompanyOwnedAgent,
  getAgentAccessContext,
} from "@/lib/agent-access";
import {
  listWorkspaceAgents,
  resolveRuntimeWorkspace,
  type WorkspaceRecord,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type RuntimeRow = typeof companyRuntimes.$inferSelect;
type WorkspaceAgent = Awaited<ReturnType<typeof listWorkspaceAgents>>[number];

type ReconciliationAgent = {
  id: string;
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  status: string;
  runtimeRef: string | null;
  dmCount: number;
};

type ReconciliationPreview = {
  runtime: {
    id: string;
    name: string;
    runtimeType: string;
    status: string;
  };
  workspace: {
    id: string;
    name: string;
  };
  current: ReconciliationAgent[];
  suggested: ReconciliationAgent[];
  unbound: ReconciliationAgent[];
  otherRuntimeCount: number;
  summary: {
    activeAgents: number;
    suggestedAgents: number;
    unboundAgents: number;
    affectedDms: number;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await resolveReconciliationContext(context);
    if (resolved instanceof Response) return resolved;

    return NextResponse.json(await buildPreview(resolved.runtime, resolved.workspace));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await resolveReconciliationContext(context);
    if (resolved instanceof Response) return resolved;

    const body = await request.json() as { agentIds?: unknown };
    if (!Array.isArray(body.agentIds) || body.agentIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "agentIds must be an array of agent IDs" }, { status: 400 });
    }

    const selectedIds = Array.from(new Set(body.agentIds.map((id) => id.trim()).filter(Boolean)));
    if (selectedIds.length === 0) {
      return NextResponse.json({ error: "Select at least one agent to archive" }, { status: 400 });
    }
    if (selectedIds.length > 500) {
      return NextResponse.json({ error: "A reconciliation can archive at most 500 agents" }, { status: 400 });
    }

    const preview = await buildPreview(resolved.runtime, resolved.workspace);
    const eligibleIds = new Set([
      ...preview.suggested.map((agent) => agent.id),
      ...preview.unbound.map((agent) => agent.id),
    ]);
    const invalidAgentIds = selectedIds.filter((id) => !eligibleIds.has(id));
    if (invalidAgentIds.length > 0) {
      return NextResponse.json(
        { error: "One or more selected agents are not eligible for reconciliation", invalidAgentIds },
        { status: 400 },
      );
    }

    const dmIds = await loadActiveDmIds(resolved.workspace, selectedIds);
    const reconciledAt = new Date();

    await withRetry(() => db!.transaction(async (tx) => {
      if (dmIds.length > 0) {
        await tx
          .update(channels)
          .set({ archivedAt: reconciledAt, updatedAt: reconciledAt })
          .where(inArray(channels.id, dmIds));
      }

      await tx
        .delete(agentWorkspaceGrants)
        .where(and(
          eq(agentWorkspaceGrants.workspaceId, resolved.workspace.id),
          inArray(agentWorkspaceGrants.agentId, selectedIds),
        ));
    }));

    return NextResponse.json({
      ok: true,
      archivedAgents: selectedIds.length,
      archivedDms: dmIds.length,
      messagesDeleted: 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function resolveReconciliationContext(
  context: { params: Promise<{ id: string }> },
): Promise<{ runtime: RuntimeRow; workspace: WorkspaceRecord } | Response> {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const access = await getAgentAccessContext();
  if (!access.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await context.params;
  const [runtime] = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, id))
      .limit(1)
  );
  if (!runtime) {
    return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
  }

  const canManage = runtime.ownerType === "user"
    ? runtime.ownerUserId === access.userId
    : canManageCompanyOwnedAgent(access, runtime.ownerCompanyId ?? runtime.companyId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const workspace = await resolveRuntimeWorkspace(runtime);
  if (!workspace) {
    return NextResponse.json({ error: "Runtime workspace not found" }, { status: 409 });
  }

  return { runtime, workspace };
}

async function buildPreview(
  runtime: RuntimeRow,
  workspace: WorkspaceRecord,
): Promise<ReconciliationPreview> {
  const workspaceAgents = await listWorkspaceAgents(workspace.id, { includeDetached: true });
  const selectableAgents = workspaceAgents.filter((agent) => !agent.runtimeId);
  const dmIdsByAgent = await loadActiveDmIdsByAgent(
    workspace,
    selectableAgents.map((agent) => agent.id),
  );

  const current: ReconciliationAgent[] = [];
  const suggested: ReconciliationAgent[] = [];
  const unbound: ReconciliationAgent[] = [];
  let otherRuntimeCount = 0;

  for (const agent of workspaceAgents) {
    if (agent.runtimeId === runtime.id) {
      current.push(toReconciliationAgent(agent, dmIdsByAgent));
    } else if (agent.runtimeId) {
      otherRuntimeCount += 1;
    } else if (agent.runtimeRef) {
      suggested.push(toReconciliationAgent(agent, dmIdsByAgent));
    } else {
      unbound.push(toReconciliationAgent(agent, dmIdsByAgent));
    }
  }

  const affectedDmIds = new Set<string>();
  for (const agent of [...suggested, ...unbound]) {
    for (const channelId of dmIdsByAgent.get(agent.id) ?? []) {
      affectedDmIds.add(channelId);
    }
  }

  return {
    runtime: {
      id: runtime.id,
      name: runtime.name,
      runtimeType: runtime.runtimeType,
      status: runtime.status,
    },
    workspace: { id: workspace.id, name: workspace.name },
    current,
    suggested,
    unbound,
    otherRuntimeCount,
    summary: {
      activeAgents: current.length,
      suggestedAgents: suggested.length,
      unboundAgents: unbound.length,
      affectedDms: affectedDmIds.size,
    },
  };
}

function toReconciliationAgent(
  agent: WorkspaceAgent,
  dmIdsByAgent: Map<string, Set<string>>,
): ReconciliationAgent {
  return {
    id: agent.id,
    callsign: agent.callsign,
    name: agent.name,
    title: agent.title,
    emoji: agent.emoji,
    status: agent.status,
    runtimeRef: agent.runtimeRef ?? null,
    dmCount: dmIdsByAgent.get(agent.id)?.size ?? 0,
  };
}

async function loadActiveDmIds(workspace: WorkspaceRecord, agentIds: string[]) {
  const dmIdsByAgent = await loadActiveDmIdsByAgent(workspace, agentIds);
  return Array.from(new Set(Array.from(dmIdsByAgent.values()).flatMap((ids) => Array.from(ids))));
}

async function loadActiveDmIdsByAgent(workspace: WorkspaceRecord, agentIds: string[]) {
  const result = new Map<string, Set<string>>();
  if (agentIds.length === 0) return result;

  const memberRows = await withRetry(() =>
    db!
      .select({ channelId: channelMembers.channelId, agentId: channelMembers.agentId })
      .from(channelMembers)
      .where(inArray(channelMembers.agentId, agentIds))
  );
  const channelIds = Array.from(new Set(memberRows.map((row) => row.channelId)));
  if (channelIds.length === 0) return result;

  const channelRows = await withRetry(() =>
    db!
      .select({
        id: channels.id,
        companyId: channels.companyId,
        workspaceId: channels.workspaceId,
        type: channels.type,
      })
      .from(channels)
      .where(and(
        inArray(channels.id, channelIds),
        eq(channels.type, "dm"),
        isNull(channels.archivedAt),
        workspace.companyId
          ? eq(channels.companyId, workspace.companyId)
          : eq(channels.workspaceId, workspace.id),
      ))
  );
  const activeDmIds = new Set(channelRows.map((channel) => channel.id));

  for (const row of memberRows) {
    if (!row.agentId || !activeDmIds.has(row.channelId)) continue;
    const ids = result.get(row.agentId) ?? new Set<string>();
    ids.add(row.channelId);
    result.set(row.agentId, ids);
  }

  return result;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}
