import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { AGENT_META } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    return NextResponse.json({ agents: [], source: "none" });
  }

  try {
    const heartbeats = await withRetry(() =>
      db!.select().from(schema.agentHeartbeats)
    );

    if (!heartbeats || heartbeats.length === 0) {
      return NextResponse.json({ agents: [], source: "none" });
    }

    const agents = heartbeats.map((hb) => {
      const meta = AGENT_META[hb.agentId] ?? {
        callsign: hb.callsign || hb.agentId,
        name: hb.callsign || hb.agentId,
        title: "Agent",
        emoji: "\u{1F916}",
        color: "#888888",
        reportsTo: null,
        soulContent: null,
      };

      // Extract tokenUsage from rawData (safe cast)
      const rawData = hb.rawData as Record<string, unknown> | null;
      const tokenUsage = rawData?.tokenUsage ?? null;

      return {
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
        adapterType: "openclaw_gateway",
        adapterConfig: {},
        role: "engineer",
        model: null,
        workspacePath: null,
        tokenUsage,
      };
    });

    return NextResponse.json({ agents, source: "live" });
  } catch (err) {
    console.error("[api/openclaw/agents] Error:", err);
    return NextResponse.json({ agents: [], source: "none" });
  }
}
