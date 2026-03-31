import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
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
    // Find agent in DB by callsign (case-insensitive via uppercase match)
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Try to merge heartbeat data if available
    const heartbeats = await withRetry(() =>
      db!.select().from(schema.agentHeartbeats)
    ).catch(() => []);
    const hb = heartbeats.find(
      (h) => (h.callsign ?? "").toLowerCase() === callsign.toLowerCase()
    );

    return NextResponse.json({
      id: agent.id,
      callsign: agent.callsign,
      name: agent.name,
      title: agent.title,
      emoji: agent.emoji,
      color: agent.color,
      status: hb?.status ?? agent.status ?? "offline",
      currentTask: hb?.currentTask ?? agent.currentTask ?? null,
      lastActive: hb?.lastActive?.toISOString() ?? agent.lastActive?.toISOString() ?? new Date().toISOString(),
      reportsTo: agent.reportsTo,
      soulContent: agent.soulContent,
      adapterType: agent.adapterType,
      adapterConfig: agent.adapterConfig ?? {},
      role: agent.role ?? "engineer",
      model: agent.model ?? null,
      workspacePath: agent.workspacePath ?? null,
      tokenUsage: hb?.rawData ? (hb.rawData as Record<string, unknown>)?.tokenUsage ?? null : null,
    });
  } catch (err) {
    console.error("[api/agents/callsign] Error:", err);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();

    // Find the agent first
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Build update object from allowed fields
    const allowedFields = [
      "name", "callsign", "title", "emoji", "color",
      "adapterType", "adapterConfig", "role", "model",
      "workspacePath", "reportsTo", "companyId", "soulContent", "status",
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Map camelCase fields to snake_case for Drizzle
    const columnMap: Record<string, string> = {
      adapterType: "adapter_type",
      adapterConfig: "adapter_config",
      workspacePath: "workspace_path",
      reportsTo: "reports_to",
      companyId: "company_id",
      soulContent: "soul_content",
      currentTask: "current_task",
      lastActive: "last_active",
    };

    const drizzleUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      const col = columnMap[key] || key;
      drizzleUpdates[col] = value;
    }

    // Use raw SQL set for dynamic updates via Drizzle
    const [updated] = await withRetry(() =>
      db!
        .update(schema.agents)
        .set(updates)
        .where(eq(schema.agents.id, agent.id))
        .returning()
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/agents/callsign] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { callsign } = await params;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    await withRetry(() =>
      db!.delete(schema.agents).where(eq(schema.agents.id, agent.id))
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/agents/callsign] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
