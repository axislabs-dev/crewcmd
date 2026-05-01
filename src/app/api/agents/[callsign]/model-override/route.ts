import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agents } from "@/db/schema";
import { canUpdateAgent, getAgentAccessContext } from "@/lib/agent-access";
import { requireAuth } from "@/lib/require-auth";
import { discoverRuntimeModels } from "@/lib/runtime-model-discovery";
import { syncAgentModelToRuntime } from "@/lib/runtime-agent-model-sync";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ callsign: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

  const { callsign } = await params;
  const access = await getAgentAccessContext();
  const body = await request.json();
  const model = readOptionalString(body.model);

  if (!model) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  const agent = await findAgent(callsign);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!canUpdateAgent(agent, access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (agent.runtimeId) {
    const availableModels = await discoverRuntimeModels(agent.runtimeId);
    const modelIds = new Set(availableModels.map((availableModel) => availableModel.id));
    if (!modelIds.has(model)) {
      return NextResponse.json(
        { error: "Model is not available on the agent runtime", availableModels },
        { status: 400 }
      );
    }
  }

  if (agent.runtimeId && agent.runtimeRef) {
    try {
      await syncAgentModelToRuntime({
        runtimeId: agent.runtimeId,
        runtimeRef: agent.runtimeRef,
        primaryModel: model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync runtime model";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const [updated] = await withRetry(() =>
    db!
      .update(agents)
      .set({ model })
      .where(eq(agents.id, agent.id))
      .returning()
  );

  return NextResponse.json({
    model: updated?.model ?? model,
    runtimeSynced: Boolean(agent.runtimeId && agent.runtimeRef),
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

  const { callsign } = await params;
  const access = await getAgentAccessContext();
  const agent = await findAgent(callsign);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!canUpdateAgent(agent, access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await withRetry(() =>
    db!
      .update(agents)
      .set({ model: null })
      .where(eq(agents.id, agent.id))
  );

  return NextResponse.json({
    model: null,
    runtimeSynced: false,
    runtimeSyncReason: "effective model resolution is required before clearing runtime config",
  });
}

async function findAgent(callsign: string): Promise<typeof agents.$inferSelect | null> {
  if (!db) return null;
  const rows = await withRetry(() => db!.select().from(agents));
  return rows.find((agent) => agent.callsign.toLowerCase() === callsign.toLowerCase()) ?? null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
