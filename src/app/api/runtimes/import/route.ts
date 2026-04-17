import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents, companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DiscoveredAgent, GatewayModel } from "@/lib/gateway-client";
import { pushSkillToRuntime } from "@/lib/push-skill-to-runtime";
import {
  canManageCompanyOwnedAgent,
  getAgentAccessContext,
  normalizeVisibilityForCreation,
  resolveRuntimeOwnership,
} from "@/lib/agent-access";
import {
  getRequestOrigin,
  type RuntimeMetadata,
} from "@/lib/runtime-callback-url";
import { ensureCrewCmdRuntimeOperatingLayer } from "@/lib/runtime-operating-layer";

export const dynamic = "force-dynamic";

interface ImportBody {
  runtimeId: string;
  agents: DiscoveredAgent[];
  models?: GatewayModel[];
  defaultAgentId?: string;
  devicePrivateKeyPem?: string;
  ownerType?: "user" | "company";
  visibility?: "private" | "team" | "org";
}

// Color palette for imported agents
const COLORS = [
  "#00f0ff", "#f0ff00", "#ff6600", "#ff4444", "#00ff88",
  "#ff00aa", "#aa88ff", "#88ff00", "#ff8800", "#aaaaff",
  "#ffdd00", "#00ddff",
];

/**
 * POST /api/runtimes/import
 *
 * Import discovered agents into CrewCmd's database, linked to a runtime.
 * Creates agent records with adapter_type=openclaw_gateway.
 *
 * Body: { runtimeId, agents: DiscoveredAgent[] }
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const companyId = cookieStore.get("active_company")?.value;
    if (!companyId) {
      return NextResponse.json({ error: "No active company" }, { status: 400 });
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const callbackBaseUrl = getRequestOrigin(request);
    const body: ImportBody = await request.json();
    const {
      runtimeId,
      agents: importAgents,
      defaultAgentId,
      devicePrivateKeyPem,
      ownerType,
      visibility,
    } = body;

    if (!runtimeId || !importAgents?.length) {
      return NextResponse.json(
        { error: "runtimeId and agents array are required" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    // Verify the runtime exists and belongs to this company
    const [runtime] = await withRetry(() => db!
      .select()
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, runtimeId)));

    if (!runtime || runtime.companyId !== companyId) {
      return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
    }

    const runtimeOwnership = await resolveRuntimeOwnership(runtimeId);
    const effectiveOwnerType = runtimeOwnership?.ownerType ?? (ownerType === "company" ? "company" : "user");
    const effectiveOwnerUserId = runtimeOwnership?.ownerUserId ?? (effectiveOwnerType === "user" ? access.userId : null);
    const effectiveOwnerCompanyId = runtimeOwnership?.ownerCompanyId ?? (effectiveOwnerType === "company" ? companyId : null);

    if (ownerType && runtimeOwnership && ownerType !== runtimeOwnership.ownerType) {
      return NextResponse.json({ error: "Import ownership must match the selected runtime" }, { status: 400 });
    }

    if (effectiveOwnerType === "company" && !canManageCompanyOwnedAgent(access, effectiveOwnerCompanyId)) {
      return NextResponse.json({ error: "Only company admins can import team-owned agents" }, { status: 403 });
    }

    const effectiveVisibility = normalizeVisibilityForCreation({
      ownerType: effectiveOwnerType,
      requestedVisibility: visibility,
    });

    // Store device private key in the runtime metadata for persistent device auth
    if (devicePrivateKeyPem || callbackBaseUrl) {
      const nextMetadata: RuntimeMetadata = {
        ...((runtime.metadata || {}) as RuntimeMetadata),
        callbackBaseUrl,
      };
      if (defaultAgentId) {
        nextMetadata.defaultAgentId = defaultAgentId;
      }
      if (devicePrivateKeyPem) {
        nextMetadata.devicePrivateKeyPem = devicePrivateKeyPem;
      }

      await withRetry(() => db!
        .update(companyRuntimes)
        .set({
          metadata: nextMetadata,
        })
        .where(eq(companyRuntimes.id, runtimeId)));
    }

    // Get existing agents to avoid duplicates
    const existingAgents = await withRetry(() => db!
      .select({
        id: agents.id,
        callsign: agents.callsign,
        runtimeId: agents.runtimeId,
        runtimeRef: agents.runtimeRef,
        name: agents.name,
        workspacePath: agents.workspacePath,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId)));

    const existingCallsigns = new Set(
      existingAgents.map((a) => a.callsign.toLowerCase())
    );
    const existingByRuntimeRef = new Map(
      existingAgents
        .filter((agent) => agent.runtimeRef)
        .map((agent) => [agent.runtimeRef!, agent] as const)
    );
    const detachedByCallsign = new Map(
      existingAgents
        .filter((agent) => !agent.runtimeId)
        .map((agent) => [agent.callsign.toLowerCase(), agent] as const)
    );

    const created: { callsign: string; name: string; id: string }[] = [];
    const reattached: { callsign: string; name: string; id: string }[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (let i = 0; i < importAgents.length; i++) {
      const agent = importAgents[i];
      const callsign =
        agent.name?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) ||
        agent.id.toUpperCase();
      const existingByRef = existingByRuntimeRef.get(agent.id);
      const existingDetached = detachedByCallsign.get(callsign.toLowerCase());

      // Reattach if this agent identity is already known
      const agentToReattach = existingByRef ?? existingDetached;
      if (agentToReattach) {
        try {
          const conflictingRow = existingAgents.find((row) => {
            if (row.id === agentToReattach.id) return false;
            if (row.callsign.toLowerCase() !== callsign.toLowerCase()) return false;
            return isLegacyDuplicate(row, agent);
          });

          if (conflictingRow) {
            await withRetry(() =>
              db!.delete(agents).where(eq(agents.id, conflictingRow.id))
            );

            const conflictIndex = existingAgents.findIndex((row) => row.id === conflictingRow.id);
            if (conflictIndex >= 0) existingAgents.splice(conflictIndex, 1);
            existingCallsigns.delete(conflictingRow.callsign.toLowerCase());
            detachedByCallsign.delete(conflictingRow.callsign.toLowerCase());
          }

          const [updatedAgent] = await withRetry(() => db!
            .update(agents)
            .set({
              callsign,
              name: agent.name || agent.id,
              title: agent.title || "Agent",
              emoji: agent.emoji || "🤖",
              color: COLORS[i % COLORS.length],
              status: "online",
              soulContent: agent.description || null,
              adapterType: "openclaw_gateway",
              adapterConfig: {
                url: runtime.httpUrl,
                headers: runtime.authToken
                  ? { Authorization: `Bearer ${runtime.authToken}` }
                  : undefined,
              },
              role: "engineer",
              model: agent.model || null,
              workspacePath: agent.workspace || null,
              runtimeId,
              runtimeRef: agent.id,
              reportsTo: agent.reportsTo || null,
              avatarUrl: agent.avatarUrl || null,
              ownerType: effectiveOwnerType,
              ownerUserId: effectiveOwnerUserId,
              ownerCompanyId: effectiveOwnerCompanyId,
              visibility: effectiveVisibility,
            })
            .where(eq(agents.id, agentToReattach.id))
            .returning({ id: agents.id, callsign: agents.callsign, name: agents.name }));

          const existingIndex = existingAgents.findIndex((row) => row.id === agentToReattach.id);
          if (existingIndex >= 0) {
            existingAgents[existingIndex] = {
              ...existingAgents[existingIndex],
              callsign,
              runtimeId,
              runtimeRef: agent.id,
              name: agent.name || agent.id,
              workspacePath: agent.workspace || null,
            };
          }
          existingCallsigns.add(callsign.toLowerCase());
          existingByRuntimeRef.set(agent.id, {
            ...agentToReattach,
            callsign,
            runtimeId,
            runtimeRef: agent.id,
            name: agent.name || agent.id,
            workspacePath: agent.workspace || null,
          });
          detachedByCallsign.delete(callsign.toLowerCase());
          reattached.push(updatedAgent);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped.push({ id: agent.id, reason: msg });
        }
        continue;
      }

      // Deduplicate callsign
      let finalCallsign = callsign;
      let suffix = 2;
      while (existingCallsigns.has(finalCallsign.toLowerCase())) {
        finalCallsign = `${callsign}${suffix}`;
        suffix++;
      }
      existingCallsigns.add(finalCallsign.toLowerCase());

      const color = COLORS[i % COLORS.length];

      try {
        const [created_agent] = await withRetry(() => db!
          .insert(agents)
          .values({
            callsign: finalCallsign,
            name: agent.name || agent.id,
            title: agent.title || "Agent",
            emoji: agent.emoji || "🤖",
            color,
            status: "online",
            soulContent: agent.description || null,
            companyId,
            adapterType: "openclaw_gateway",
            adapterConfig: {
              url: runtime.httpUrl,
              headers: runtime.authToken
                ? { Authorization: `Bearer ${runtime.authToken}` }
                : undefined,
            },
            role: "engineer",
            model: agent.model || null,
            workspacePath: agent.workspace || null,
            runtimeId,
            runtimeRef: agent.id,
            reportsTo: agent.reportsTo || null,
            avatarUrl: agent.avatarUrl || null,
            ownerType: effectiveOwnerType,
            ownerUserId: effectiveOwnerUserId,
            ownerCompanyId: effectiveOwnerCompanyId,
            visibility: effectiveVisibility,
          })
          .returning({ id: agents.id, callsign: agents.callsign, name: agents.name }));

        created.push(created_agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ id: agent.id, reason: msg });
      }
    }

    // Always refresh the CrewCmd management skill on runtime import/reconnect.
    // This keeps existing linked agents updated even when this import pass
    // did not create or reattach any new database rows.
    try {
      await pushSkillToRuntime(runtimeId);
      await ensureCrewCmdRuntimeOperatingLayer(runtimeId);
    } catch (skillErr) {
      console.warn(
        "[api/runtimes/import] Skill push failed (non-fatal):",
        skillErr instanceof Error ? skillErr.message : String(skillErr)
      );
    }

    return NextResponse.json({
      imported: created.length,
      reattached: reattached.length,
      skipped: skipped.length,
      agents: [...reattached, ...created],
      skippedDetails: skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isLegacyDuplicate(
  existing: {
    runtimeId: string | null;
    runtimeRef: string | null;
    name: string;
    workspacePath: string | null;
  },
  agent: DiscoveredAgent
): boolean {
  if (existing.runtimeId) return false;
  if (existing.runtimeRef) return false;

  const existingName = existing.name.trim().toLowerCase();
  const incomingName = (agent.name || agent.id).trim().toLowerCase();
  if (existingName === incomingName) return true;

  const existingWorkspace = (existing.workspacePath || "").trim();
  const incomingWorkspace = (agent.workspace || "").trim();
  return !!existingWorkspace && !!incomingWorkspace && existingWorkspace === incomingWorkspace;
}
