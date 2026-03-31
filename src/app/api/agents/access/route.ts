import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/access — List access grants.
 * Query params: company_id (required), agent_id (optional), user_id (optional)
 */
export async function GET(request: NextRequest) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const companyId = request.nextUrl.searchParams.get("company_id");
    const agentId = request.nextUrl.searchParams.get("agent_id");
    const userId = request.nextUrl.searchParams.get("user_id");

    if (!companyId) {
      return NextResponse.json({ error: "company_id is required" }, { status: 400 });
    }

    // Build a dynamic query to join agents + grants
    const conditions: string[] = ["a.company_id = $1"];
    const params: string[] = [companyId];
    let idx = 2;

    if (agentId) {
      conditions.push(`g.agent_id = $${idx}`);
      params.push(agentId);
      idx++;
    }
    if (userId) {
      conditions.push(`g.user_id = $${idx}`);
      params.push(userId);
      idx++;
    }

    const rows = await withRetry(() =>
      db!.execute(sql.raw(`
        SELECT
          g.id,
          g.agent_id AS "agentId",
          g.user_id AS "userId",
          g.granted_by AS "grantedBy",
          g.can_interact AS "canInteract",
          g.can_configure AS "canConfigure",
          g.can_view_logs AS "canViewLogs",
          g.created_at AS "createdAt",
          a.callsign AS "agentCallsign",
          a.name AS "agentName",
          a.emoji AS "agentEmoji",
          a.visibility AS "agentVisibility",
          u.name AS "userName",
          u.email AS "userEmail"
        FROM agent_access_grants g
        JOIN agents a ON a.id = g.agent_id
        JOIN users u ON u.id = g.user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.callsign, u.name
      `.replace("$1", `'${companyId}'`)
        .replace(agentId ? "$2" : "", agentId ? `'${agentId}'` : "")
        .replace(userId ? `$${agentId ? 3 : 2}` : "", userId ? `'${userId}'` : "")
      ))
    );

    return NextResponse.json(rows.rows ?? rows);
  } catch (err) {
    console.error("[api/agents/access] GET Error:", err);
    return NextResponse.json([]);
  }
}

/**
 * POST /api/agents/access — Grant a user access to an agent.
 * Body: { agentId, userId, canInteract?, canConfigure?, canViewLogs? }
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { agentId, userId, grantedBy, canInteract, canConfigure, canViewLogs } = body;

    if (!agentId || !userId) {
      return NextResponse.json({ error: "agentId and userId are required" }, { status: 400 });
    }

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        INSERT INTO agent_access_grants (agent_id, user_id, granted_by, can_interact, can_configure, can_view_logs)
        VALUES (
          '${agentId}',
          '${userId}',
          '${grantedBy ?? "system"}',
          ${canInteract !== false},
          ${canConfigure === true},
          ${canViewLogs !== false}
        )
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

    const created = (result.rows ?? result)[0];
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/agents/access] POST Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "Access grant already exists for this user/agent" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create access grant" }, { status: 500 });
  }
}
