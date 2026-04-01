import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents, companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DiscoveredAgent, GatewayModel } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

interface ImportBody {
  runtimeId: string;
  agents: DiscoveredAgent[];
  models?: GatewayModel[];
  defaultAgentId?: string;
  devicePrivateKeyPem?: string;
}

// Color palette for imported agents
const COLORS = [
  "#00f0ff", "#f0ff00", "#ff6600", "#ff4444", "#00ff88",
  "#ff00aa", "#aa88ff", "#88ff00", "#ff8800", "#aaaaff",
  "#ffdd00", "#00ddff",
];

/**
 * POST /api/runtimes/import
 *
 * Import discovered agents into CrewCmd's database, linked to a runtime.
 * Creates agent records with adapter_type=openclaw_gateway.
 *
 * Body: { runtimeId, agents: DiscoveredAgent[] }
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const companyId = cookieStore.get("active_company")?.value;
    if (!companyId) {
      return NextResponse.json({ error: "No active company" }, { status: 400 });
    }

    const body: ImportBody = await request.json();
    const { runtimeId, agents: importAgents, devicePrivateKeyPem } = body;

    if (!runtimeId || !importAgents?.length) {
      return NextResponse.json(
        { error: "runtimeId and agents array are required" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    // Verify the runtime exists and belongs to this company
    const [runtime] = await withRetry(() => db!
      .select()
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, runtimeId)));

    if (!runtime || runtime.companyId !== companyId) {
      return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
    }

    // Store device private key in the runtime metadata for persistent device auth
    if (devicePrivateKeyPem) {
      await withRetry(() => db!
        .update(companyRuntimes)
        .set({
          metadata: {
            ...((runtime.metadata || {}) as Record<string, unknown>),
            devicePrivateKeyPem,
          },
        })
        .where(eq(companyRuntimes.id, runtimeId)));
    }

    // Get existing agents to avoid duplicates
    const existingAgents = await withRetry(() => db!
      .select({ callsign: agents.callsign, runtimeRef: agents.runtimeRef })
      .from(agents)
      .where(eq(agents.companyId, companyId)));

    const existingCallsigns = new Set(
      existingAgents.map((a) => a.callsign.toLowerCase())
    );
    const existingRefs = new Set(
      existingAgents.filter((a) => a.runtimeRef).map((a) => a.runtimeRef!)
    );

    const created: { callsign: string; name: string; id: string }[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (let i = 0; i < importAgents.length; i++) {
      const agent = importAgents[i];
      const callsign =
        agent.name?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) ||
        agent.id.toUpperCase();

      // Skip if already imported
      if (existingRefs.has(agent.id)) {
        skipped.push({ id: agent.id, reason: "Already imported (runtime_ref match)" });
        continue;
      }

      // Deduplicate callsign
      let finalCallsign = callsign;
      let suffix = 2;
      while (existingCallsigns.has(finalCallsign.toLowerCase())) {
        finalCallsign = `${callsign}${suffix}`;
        suffix++;
      }
      existingCallsigns.add(finalCallsign.toLowerCase());

      const color = COLORS[i % COLORS.length];

      try {
        const [created_agent] = await withRetry(() => db!
          .insert(agents)
          .values({
            callsign: finalCallsign,
            name: agent.name || agent.id,
            title: agent.title || "Agent",
            emoji: agent.emoji || "🤖",
            color,
            status: "online",
            soulContent: agent.description || null,
            companyId,
            adapterType: "openclaw_gateway",
            adapterConfig: {
              url: runtime.httpUrl,
              headers: runtime.authToken
                ? { Authorization: `Bearer ${runtime.authToken}` }
                : undefined,
            },
            role: "engineer",
            model: agent.model || null,
            runtimeId,
            runtimeRef: agent.id,
            reportsTo: agent.reportsTo || null,
          })
          .returning({ id: agents.id, callsign: agents.callsign, name: agents.name }));

        created.push(created_agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ id: agent.id, reason: msg });
      }
    }

    return NextResponse.json({
      imported: created.length,
      skipped: skipped.length,
      agents: created,
      skippedDetails: skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
