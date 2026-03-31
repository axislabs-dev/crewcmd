import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime, type AgentTask, type AgentConfig } from "@/lib/agent-runtime";
import { getExecutor, type AdapterConfig } from "@/lib/adapters";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** POST /api/agents/[callsign]/task — Send a task to an agent for execution */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let body: { prompt?: string; taskId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "Missing required field: prompt" }, { status: 400 });
  }

  const adapter = getExecutor(agent.adapterType);
  if (!adapter) {
    return NextResponse.json(
      { error: `Unknown adapter type: ${agent.adapterType}` },
      { status: 400 }
    );
  }

  // Check adapter availability
  const available = await adapter.isAvailable();
  if (!available) {
    return NextResponse.json(
      { error: `${adapter.name} is not installed or not available on this system` },
      { status: 422 }
    );
  }

  // Ensure agent is started in the runtime
  let proc = runtime.getStatus(agent.id);
  if (!proc || proc.status !== "running") {
    const adapterConfig: AdapterConfig = {
      ...(agent.adapterConfig as AdapterConfig),
      model: agent.model ?? undefined,
      workspacePath: agent.workspacePath ?? undefined,
    };
    const config: AgentConfig = {
      agentId: agent.id,
      callsign: agent.callsign,
      adapterType: agent.adapterType,
      adapterConfig,
      model: agent.model ?? undefined,
      workspacePath: agent.workspacePath ?? undefined,
    };
    runtime.storeAdapterConfig(agent.id, adapterConfig);
    await runtime.startAgent(agent.id, config);
    proc = runtime.getStatus(agent.id);
  }

  // Prepend prompt template if configured
  const adapterCfg = agent.adapterConfig as Record<string, unknown>;
  const promptTemplate = adapterCfg.promptTemplate as string | undefined;
  const finalPrompt = promptTemplate
    ? `${promptTemplate}\n\n${body.prompt}`
    : body.prompt;

  const task: AgentTask = {
    id: body.taskId ?? randomUUID(),
    prompt: finalPrompt,
    status: "pending",
    createdAt: new Date(),
  };

  try {
    const output = await runtime.sendTask(agent.id, task);
    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      output,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { taskId: task.id, status: "failed", error: message },
      { status: 500 }
    );
  }
}
