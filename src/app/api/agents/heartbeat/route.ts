import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { validateHeartbeatAuth } from "@/lib/heartbeat-auth";

export const dynamic = "force-dynamic";

interface HeartbeatPayload {
  agent_id: string;
  callsign?: string;
  status?: string;
  current_task?: string | null;
  last_active?: string | number;
  session_count?: number;
  raw_data?: Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  const authError = validateHeartbeatAuth(req);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const agents: HeartbeatPayload[] = Array.isArray(body) ? body : body.agents;

    if (!agents || !Array.isArray(agents)) {
      return NextResponse.json(
        { error: "Expected array of agent statuses" },
        { status: 400 }
      );
    }

    let upserted = 0;
    for (const agent of agents) {
      if (!agent.agent_id) continue;

      await db
        .insert(schema.agentHeartbeats)
        .values({
          agentId: agent.agent_id,
          callsign: agent.callsign ?? agent.agent_id,
          status: agent.status ?? "offline",
          currentTask: agent.current_task ?? null,
          lastActive: agent.last_active
            ? new Date(agent.last_active)
            : new Date(),
          sessionCount: agent.session_count ?? 0,
          rawData: agent.raw_data ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.agentHeartbeats.agentId,
          set: {
            callsign: agent.callsign ?? agent.agent_id,
            status: agent.status ?? "offline",
            currentTask: agent.current_task ?? null,
            lastActive: agent.last_active
              ? new Date(agent.last_active)
              : new Date(),
            sessionCount: agent.session_count ?? 0,
            rawData: agent.raw_data ?? null,
            updatedAt: new Date(),
          },
        });

      upserted++;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (err) {
    console.error("[api/agents/heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Failed to process heartbeat" },
      { status: 500 }
    );
  }
}
