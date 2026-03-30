import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentHeartbeats } from "@/db/schema";
import { AGENT_META } from "@/lib/openclaw";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    // Find by callsign in heartbeats (case-insensitive)
    const heartbeats = await db.select().from(agentHeartbeats);
    const hb = heartbeats.find(
      (h) => (h.callsign ?? "").toLowerCase() === callsign.toLowerCase()
    );

    if (!hb) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const meta = AGENT_META[hb.agentId] ?? {
      callsign: hb.callsign || hb.agentId,
      name: hb.callsign || hb.agentId,
      title: "Agent",
      emoji: "🤖",
      color: "#888888",
      reportsTo: null,
      soulContent: null,
    };

    return NextResponse.json({
      id: `agent-${meta.callsign.toLowerCase()}`,
      callsign: meta.callsign,
      name: meta.name,
      title: meta.title,
      emoji: meta.emoji,
      color: meta.color,
      status: hb.status || "offline",
      currentTask: hb.currentTask ?? null,
      lastActive: hb.lastActive?.toISOString() ?? new Date().toISOString(),
      reportsTo: meta.reportsTo,
      soulContent: meta.soulContent,
    });
  } catch (err) {
    console.error("[api/agents/callsign] Error:", err);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}
