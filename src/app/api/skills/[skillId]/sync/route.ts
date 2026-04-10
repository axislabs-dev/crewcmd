import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, agents, skills } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const { skillId } = await params;

  const [skill] = await withRetry(() =>
    db!
      .select({ id: skills.id, companyId: skills.companyId })
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1)
  );

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const assignments = await withRetry(() =>
    db!
      .select({ agentId: agentSkills.agentId })
      .from(agentSkills)
      .innerJoin(agents, eq(agentSkills.agentId, agents.id))
      .where(
        and(
          eq(agentSkills.skillId, skillId),
          eq(agents.companyId, skill.companyId)
        )
      )
  );

  const failed: Array<{ agentId: string; error: string }> = [];
  let synced = 0;

  for (const assignment of assignments) {
    try {
      const result = await syncSkillToOpenClaw({
        skillId,
        agentId: assignment.agentId,
        companyId: skill.companyId,
      });

      if (result.success) {
        synced += 1;
      } else {
        failed.push({
          agentId: assignment.agentId,
          error: result.errors.join("; ") || "Sync failed",
        });
      }
    } catch (error) {
      failed.push({
        agentId: assignment.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ synced, failed });
}
