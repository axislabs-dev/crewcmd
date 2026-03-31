import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/agents/access/[id] — Update access grant permissions.
 * Body: { canInteract?, canConfigure?, canViewLogs? }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const sets: string[] = [];

    if (body.canInteract !== undefined) {
      sets.push(`can_interact = ${body.canInteract === true}`);
    }
    if (body.canConfigure !== undefined) {
      sets.push(`can_configure = ${body.canConfigure === true}`);
    }
    if (body.canViewLogs !== undefined) {
      sets.push(`can_view_logs = ${body.canViewLogs === true}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        UPDATE agent_access_grants
        SET ${sets.join(", ")}
        WHERE id = '${id}'
        RETURNING
          id,
          agent_id AS "agentId",
          user_id AS "userId",
          granted_by AS "grantedBy",
          can_interact AS "canInteract",
          can_configure AS "canConfigure",
          can_view_logs AS "canViewLogs",
          created_at AS "createdAt"
      `))
    );

    const rows = result.rows ?? result;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("[api/agents/access] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update grant" }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/access/[id] — Revoke an access grant.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  try {
    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        DELETE FROM agent_access_grants WHERE id = '${id}'
        RETURNING id
      `))
    );

    const rows = result.rows ?? result;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/agents/access] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to revoke grant" }, { status: 500 });
  }
}
