import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodeStatus } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.HEARTBEAT_SECRET;
  if (!secret) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  try {
    const nodes = await req.json();
    const arr = Array.isArray(nodes) ? nodes : [];

    for (const node of arr) {
      await db.insert(nodeStatus).values({
        id: node.id ?? node.nodeId ?? node.name,
        name: node.displayName ?? node.name,
        status: node.connected ? "connected" : "disconnected",
        platform: node.platform ?? null,
        version: node.version ?? null,
        remoteIp: node.remoteIp ?? null,
        connectedAt: node.connectedAtMs ? new Date(node.connectedAtMs) : null,
        lastSeen: node.ts ? new Date(node.ts) : new Date(),
        raw: node,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: nodeStatus.id,
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          platform: sql`excluded.platform`,
          version: sql`excluded.version`,
          remoteIp: sql`excluded.remote_ip`,
          connectedAt: sql`excluded.connected_at`,
          lastSeen: sql`excluded.last_seen`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }

    return NextResponse.json({ ok: true, upserted: arr.length });
  } catch (err) {
    console.error("[api/openclaw/nodes/push] Error:", err);
    return NextResponse.json({ error: "Failed to process nodes" }, { status: 500 });
  }
}
