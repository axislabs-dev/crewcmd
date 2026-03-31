import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import { sql } from "drizzle-orm";
import type { AgentVisibility } from "@/db/schema-access";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

const VALID_TIERS: AgentVisibility[] = ["private", "assigned", "team"];

/**
 * PATCH /api/agents/[callsign]/visibility — Change agent visibility tier.
 * Body: { visibility: 'private' | 'assigned' | 'team' }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { visibility } = body;

    if (!visibility || !VALID_TIERS.includes(visibility)) {
      return NextResponse.json(
        { error: `visibility must be one of: ${VALID_TIERS.join(", ")}` },
        { status: 400 }
      );
    }

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        UPDATE agents
        SET visibility = '${visibility}'
        WHERE LOWER(callsign) = LOWER('${callsign}')
        RETURNING id, callsign, visibility
      `))
    );

    const rows = result.rows ?? result;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("[api/agents/visibility] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update visibility" }, { status: 500 });
  }
}
