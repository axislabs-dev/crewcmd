import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

async function findAgent(callsign: string) {
  const dbAgents = await withRetry(() => db!.select().from(schema.agents));
  return dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const { callsign } = await params;
    const agent = await findAgent(callsign);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const rows = await withRetry(() =>
      db!.select().from(schema.agentSkills).where(eq(schema.agentSkills.agentId, agent.id))
    );

    // Enrich with skill details
    const skillIds = rows.map((r) => r.skillId);
    if (skillIds.length === 0) {
      return NextResponse.json([]);
    }

    const allSkills = await withRetry(() => db!.select().from(schema.skills));
    const skillMap = new Map(allSkills.map((s) => [s.id, s]));

    const enriched = rows.map((r) => ({
      ...r,
      skill: skillMap.get(r.skillId) || null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[api/agents/[callsign]/skills] GET Error:", err);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign } = await params;
    const agent = await findAgent(callsign);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json();
    const { skillId } = body;

    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }

    const [created] = await withRetry(() =>
      db!.insert(schema.agentSkills).values({
        agentId: agent.id,
        skillId,
        enabled: true,
        config: {},
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/agents/[callsign]/skills] POST Error:", err);
    return NextResponse.json({ error: "Failed to attach skill" }, { status: 500 });
  }
}
