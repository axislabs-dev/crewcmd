import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/skills/[id]/agents — returns all agents with assignment status for this skill
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const { id } = await params;

    // Get all agent_skills rows for this skill
    const assignments = await withRetry(() =>
      db!.select().from(schema.agentSkills).where(eq(schema.agentSkills.skillId, id))
    );

    const result = assignments.map((a) => ({
      agentSkillId: a.id,
      agentId: a.agentId,
      skillId: a.skillId,
      enabled: a.enabled,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/skills/[id]/agents] GET Error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/skills/[id]/agents — assign or unassign an agent
// Body: { agentId: string, enabled?: boolean }
// If agent is already assigned, removes the assignment. Otherwise, creates it.
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { agentId } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    // Check if already assigned
    const existing = await withRetry(() =>
      db!
        .select()
        .from(schema.agentSkills)
        .where(
          and(
            eq(schema.agentSkills.skillId, id),
            eq(schema.agentSkills.agentId, agentId)
          )
        )
    );

    if (existing.length > 0) {
      // Unassign
      await withRetry(() =>
        db!.delete(schema.agentSkills).where(eq(schema.agentSkills.id, existing[0].id))
      );
      return NextResponse.json({ action: "removed", agentSkillId: existing[0].id });
    }

    // Assign
    const [created] = await withRetry(() =>
      db!
        .insert(schema.agentSkills)
        .values({
          agentId,
          skillId: id,
          enabled: true,
          config: {},
        })
        .returning()
    );

    return NextResponse.json({ action: "added", ...created }, { status: 201 });
  } catch (err) {
    console.error("[api/skills/[id]/agents] POST Error:", err);
    return NextResponse.json({ error: "Failed to toggle assignment" }, { status: 500 });
  }
}
