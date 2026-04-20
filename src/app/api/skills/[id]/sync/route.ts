import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, skills } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";
import { pushSecretsToGateway } from "@/lib/push-secrets-to-gateway";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const { id: skillId } = await params;

  const [skill] = await withRetry(() =>
    db!
      .select({ id: skills.id, companyId: skills.companyId, workspaceId: skills.workspaceId })
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
      .where(eq(agentSkills.skillId, skillId))
  );

  const failed: Array<{ agentId: string; error: string }> = [];
  const secretErrors: Array<{ agentId: string; error: string }> = [];
  let synced = 0;
  let secretsPushed = 0;

  for (const assignment of assignments) {
    // Step 1: Sync SKILL.md to local workspace (same-machine only)
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

    // Step 2: Push secrets to gateway as env vars (works local + remote)
    try {
      const secretResult = await pushSecretsToGateway({
        skillId,
        agentId: assignment.agentId,
        companyId: skill.companyId,
      });

      if (secretResult.ok) {
        secretsPushed += secretResult.envVarsPushed.length;
      } else {
        secretErrors.push({
          agentId: assignment.agentId,
          error: secretResult.errors.join("; "),
        });
      }
    } catch (error) {
      secretErrors.push({
        agentId: assignment.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ synced, secretsPushed, failed, secretErrors });
}
