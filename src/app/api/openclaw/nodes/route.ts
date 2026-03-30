import { NextResponse } from "next/server";
import { db } from "@/db";
import { nodeStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!db) return NextResponse.json({ nodes: [], source: "offline" });

    const nodes = await db.select().from(nodeStatus);
    return NextResponse.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        status: n.status,
        platform: n.platform,
        version: n.version,
        remoteIp: n.remoteIp,
        connectedAt: n.connectedAt?.toISOString(),
        lastSeen: n.lastSeen?.toISOString(),
      })),
      source: nodes.length > 0 ? "live" : "offline",
    });
  } catch (err) {
    console.error("[api/openclaw/nodes] DB error:", err);
    return NextResponse.json({ nodes: [], source: "offline" });
  }
}
