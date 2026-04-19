import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes, runtimeManagedResources } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { resolveRuntimeCallbackUrl } from "./runtime-callback-url";
import {
  listRuntimeManagedResources,
  upsertRuntimeManagedResource,
} from "./runtime-managed-resources";
import { uninstallSkillFromOpenClaw } from "./uninstall-skill-from-openclaw";
import { resolveRuntimeWorkspace } from "./workspace";

const DISPATCH_JOB_NAME = "crewcmd-queue-dispatch";
const DAILY_BRIEF_JOB_NAME = "crewcmd-daily-brief";

function buildQueueDispatchPrompt(params: {
  baseUrl: string;
  workspaceId: string;
  companyId?: string | null;
}): string {
  return [
    "You are running CrewCmd queue dispatch for this workspace.",
    "Use the crewcmd-management skill for all CrewCmd operations.",
    `CrewCmd base URL: ${params.baseUrl}`,
    `Workspace ID: ${params.workspaceId}`,
    ...(params.companyId ? [`Company ID: ${params.companyId}`] : []),
    "",
    "Workflow:",
    "1. List queued tasks for the workspace.",
    "2. List agents for the workspace and build a lookup from agent.id to agent.callsign.",
    "3. For each queued task with an assigned agent, resolve task.assignedAgentId to an agent callsign using that lookup.",
    "4. If no matching agent exists, leave the task queued and add a concise task comment explaining dispatch could not resolve the assigned agent in this workspace.",
    "5. If the assigned agent exists but is detached from a runtime, leave the task queued and add a concise task comment explaining the agent is not currently attached.",
    "6. If the assigned agent exists, inspect whether that agent already has an in_progress task in this workspace.",
    "7. If the assigned agent is free, dispatch work with POST /api/agents/{callsign}/task and include a real prompt containing the task title, description, task ID, and instruction to add a concise task comment acknowledging pickup before moving the task to in_progress.",
    "8. If the assigned agent is already busy, leave the task queued. If there is no queue acknowledgement comment yet, add a concise task comment saying it is queued behind the current task.",
    "9. Do not reassign tasks. Do not create duplicate tasks. Do not notify humans unless the task is blocked or needs a decision.",
    "10. Keep all audit trail on the task as comments.",
    "",
    params.companyId
      ? "Use workspace-scoped CrewCmd endpoints with workspaceId when available. companyId remains a compatible shorthand for the workspace."
      : "Use workspace-scoped CrewCmd endpoints with workspaceId. There is no company scope for this runtime.",
    "",
    "If there is nothing to dispatch, stop silently.",
  ].join("\n");
}

function buildDailyBriefPrompt(params: {
  baseUrl: string;
  workspaceId: string;
  companyId?: string | null;
}): string {
  return [
    "You are running the CrewCmd daily brief for this workspace.",
    "Use the crewcmd-management skill for all CrewCmd operations.",
    `CrewCmd base URL: ${params.baseUrl}`,
    `Workspace ID: ${params.workspaceId}`,
    ...(params.companyId ? [`Company ID: ${params.companyId}`] : []),
    "",
    "Workflow:",
    "1. Calculate a since timestamp for the last 12 hours.",
    "2. List tasks updated since then and summarize:",
    "   - tasks completed in the last 12 hours",
    "   - tasks currently in_progress",
    "   - tasks currently blocked or in review if they need attention",
    "3. List inbox messages for the workspace and include any critical or high-priority unread items that need human action.",
    ...(params.companyId
      ? [
          "4. List company members and identify the best human recipient (prefer an owner/admin).",
          "5. Create a concise inbox update for that human with the daily brief. Keep it operational and short.",
        ]
      : [
          "4. Create a concise inbox update for the workspace owner with the daily brief. Keep it operational and short.",
        ]),
    "",
    "Rules:",
    "- Do not create tasks from the daily brief.",
    "- Do not send duplicate updates if today's brief has already been sent recently.",
    "- Keep the brief concise and focused on action items, completions, and blockers.",
    "- If there is nothing notable, do not send a brief.",
  ].join("\n");
}

async function ensureManagedCronJob(params: {
  client: GatewayClient;
  runtimeId: string;
  companyId: string;
  resourceKey: string;
  agentId: string;
  description: string;
  message: string;
  schedule: Record<string, unknown>;
}) {
  const existing = await params.client.cronList();
  const job = existing.jobs.find((entry) => entry.name === params.resourceKey);

  if (!job) {
    const created = await params.client.cronAdd({
      agentId: params.agentId,
      name: params.resourceKey,
      description: params.description,
      enabled: true,
      schedule: params.schedule,
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: params.message,
      },
      delivery: {
        mode: "none",
        channel: "last",
      },
    });

    await upsertRuntimeManagedResource({
      runtimeId: params.runtimeId,
      companyId: params.companyId,
      resourceType: "cron-job",
      resourceKey: params.resourceKey,
      externalId: created.id,
      targetAgentRef: params.agentId,
      payload: created as unknown as Record<string, unknown>,
    });

    return;
  }

  const currentMessage =
    typeof job.payload?.message === "string" ? job.payload.message : "";
  const patch: Record<string, unknown> = {};

  if (job.agentId !== params.agentId) {
    patch.agentId = params.agentId;
  }
  if (currentMessage !== params.message) {
    patch.payload = {
      kind: "agentTurn",
      message: params.message,
    };
  }
  if (job.description !== params.description) {
    patch.description = params.description;
  }
  if (job.enabled !== true) {
    patch.enabled = true;
  }
  if (JSON.stringify(job.schedule ?? null) !== JSON.stringify(params.schedule)) {
    patch.schedule = params.schedule;
  }

  if (Object.keys(patch).length > 0) {
    await params.client.cronUpdate({
      id: job.id,
      patch,
    });
  }

  await upsertRuntimeManagedResource({
    runtimeId: params.runtimeId,
    companyId: params.companyId,
    resourceType: "cron-job",
    resourceKey: params.resourceKey,
    externalId: job.id,
    targetAgentRef: job.agentId ?? params.agentId,
    payload: job as unknown as Record<string, unknown>,
  });
}

export async function ensureCrewCmdRuntimeOperatingLayer(
  runtimeId: string
): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, runtimeId)).limit(1)
  );
  if (!runtime) throw new Error(`Runtime ${runtimeId} not found`);

  const metadata = (runtime.metadata || {}) as Record<string, unknown>;
  const defaultAgentId =
    typeof metadata.defaultAgentId === "string" && metadata.defaultAgentId.trim()
      ? metadata.defaultAgentId.trim()
      : "main";

  if (!runtime.gatewayUrl) {
    return;
  }

  const baseUrl = resolveRuntimeCallbackUrl({ runtime });
  const workspace = await resolveRuntimeWorkspace(runtime);
  if (!workspace) {
    throw new Error(`Workspace for runtime ${runtimeId} not found`);
  }
  if (!runtime.companyId) {
    throw new Error(`Runtime ${runtimeId} is missing company skill storage scope`);
  }
  const deviceKeyPem =
    typeof metadata.devicePrivateKeyPem === "string"
      ? metadata.devicePrivateKeyPem
      : undefined;

  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    const dispatchMessage = buildQueueDispatchPrompt({
      baseUrl,
      workspaceId: workspace.id,
      companyId: runtime.companyId ?? null,
    });
    await ensureManagedCronJob({
      client,
      runtimeId: runtime.id,
      companyId: runtime.companyId,
      resourceKey: DISPATCH_JOB_NAME,
      agentId: defaultAgentId,
      description: "CrewCmd-managed queue dispatcher",
      message: dispatchMessage,
      schedule: {
        kind: "every",
        everyMs: 5 * 60 * 1000,
        anchorMs: Date.now(),
      },
    });

    const dailyBriefMessage = buildDailyBriefPrompt({
      baseUrl,
      workspaceId: workspace.id,
      companyId: runtime.companyId ?? null,
    });
    await ensureManagedCronJob({
      client,
      runtimeId: runtime.id,
      companyId: runtime.companyId,
      resourceKey: DAILY_BRIEF_JOB_NAME,
      agentId: defaultAgentId,
      description: "CrewCmd-managed daily brief",
      message: dailyBriefMessage,
      schedule: {
        kind: "cron",
        expr: "0 5 * * *",
        tz: "Australia/Brisbane",
      },
    });
  } finally {
    client.close();
  }
}

export async function cleanupCrewCmdRuntimeOperatingLayer(runtimeId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, runtimeId)).limit(1)
  );
  if (!runtime) return;
  if (!runtime.companyId) return;

  const resources = await listRuntimeManagedResources(runtimeId);
  const metadata = (runtime.metadata || {}) as Record<string, unknown>;
  const deviceKeyPem =
    typeof metadata.devicePrivateKeyPem === "string"
      ? metadata.devicePrivateKeyPem
      : undefined;

  const runtimeClient = runtime.gatewayUrl
    ? new GatewayClient(
        runtime.gatewayUrl,
        runtime.authToken || null,
        resolveDeviceIdentity(deviceKeyPem),
        15000
      )
    : null;

  if (runtimeClient) {
    await runtimeClient.connect();
  }

  try {
    const cronResources = resources.filter((resource) => resource.resourceType === "cron-job");
    for (const resource of cronResources) {
      if (runtimeClient && resource.externalId) {
        await runtimeClient.cronRemove(resource.externalId);
      }
    }

    const skillResources = resources.filter(
      (resource) => resource.resourceType === "agent-skill"
    );
    const skillAgentIdsBySkillId = new Map<string, string>();
    for (const resource of skillResources) {
      const payload = (resource.payload || {}) as Record<string, unknown>;
      const skillId =
        typeof payload.skillId === "string" ? payload.skillId : null;
      const agentId =
        typeof payload.agentId === "string" ? payload.agentId : resource.targetAgentId;
      if (!skillId || !agentId) continue;

      if (!skillAgentIdsBySkillId.has(skillId)) {
        skillAgentIdsBySkillId.set(skillId, agentId);
      }

      await uninstallSkillFromOpenClaw({
        skillId,
        agentId,
        companyId: runtime.companyId,
      });
    }

    const skillEntryResources = resources.filter(
      (resource) => resource.resourceType === "skill-entry"
    );
    for (const resource of skillEntryResources) {
      const payload = (resource.payload || {}) as Record<string, unknown>;
      const skillId =
        typeof payload.skillId === "string"
          ? payload.skillId
          : typeof resource.externalId === "string"
            ? resource.externalId
            : null;
      if (!skillId) continue;

      const agentId = skillAgentIdsBySkillId.get(skillId);
      if (!agentId) continue;

      await uninstallSkillFromOpenClaw({
        skillId,
        agentId,
        companyId: runtime.companyId,
        forceRemoveRuntimeConfigEntry: true,
      });
    }

    const configResources = resources.filter(
      (resource) => resource.resourceType === "config-path"
    );
    for (const resource of configResources) {
      if (!runtimeClient) continue;
      const previousState = (resource.previousState || {}) as Record<string, unknown>;
      const path = resource.path;
      if (!path) continue;

      const patch = buildConfigRollbackPatch(path, previousState.value);
      if (!patch) continue;

      await runtimeClient.configPatch({
        patch,
        note: `CrewCMD runtime cleanup restored ${path}`,
      });
    }
  } finally {
    runtimeClient?.close();
  }
}

function buildConfigRollbackPatch(
  path: string,
  value: unknown
): Record<string, unknown> | null {
  if (path === "agents.defaults.heartbeat") {
    return {
      agents: {
        defaults: {
          heartbeat: value ?? null,
        },
      },
    };
  }

  const agentMatch = path.match(/^agents\.list\[(.+?)\]\.heartbeat$/);
  if (agentMatch) {
    return {
      agents: {
        list: [
          {
            id: agentMatch[1],
            heartbeat: value ?? null,
          },
        ],
      },
    };
  }

  return null;
}
