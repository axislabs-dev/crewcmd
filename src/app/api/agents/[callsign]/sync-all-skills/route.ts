import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, agents, skills } from "@/db/schema";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callsign: string }> }
) {
  const { requireAuth } = await import("@/lib/require-auth");
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const { callsign: callsignParam } = await params;

  const [agent] = await withRetry(() =>
    db!
      .select({
        id: agents.id,
        companyId: agents.companyId,
        ownerType: agents.ownerType,
        ownerUserId: agents.ownerUserId,
        ownerCompanyId: agents.ownerCompanyId,
      })
      .from(agents)
      .where(eq(agents.callsign, callsignParam))
      .limit(1)
  );

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agentId = agent.id;

  const assignments = await withRetry(() =>
    db!
      .select({
        skillId: agentSkills.skillId,
        workspaceId: skills.workspaceId,
        companyId: skills.companyId,
      })
      .from(agentSkills)
      .innerJoin(skills, eq(agentSkills.skillId, skills.id))
      .where(eq(agentSkills.agentId, agentId))
  );

  const failed: Array<{ skillId: string; error: string }> = [];
  let synced = 0;

  for (const assignment of assignments) {
    try {
        const result = await syncSkillToOpenClaw({
          skillId: assignment.skillId,
          agentId,
          companyId: assignment.companyId ?? null,
          workspaceId: assignment.workspaceId ?? null,
        });

      if (result.success) {
        synced += 1;
      } else {
        failed.push({
          skillId: assignment.skillId,
          error: result.errors.join("; ") || "Sync failed",
        });
      }
    } catch (error) {
      failed.push({
        skillId: assignment.skillId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ synced, failed });
}
