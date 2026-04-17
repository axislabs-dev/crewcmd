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

const DISPATCH_JOB_NAME = "crewcmd-queue-dispatch";

function buildQueueDispatchPrompt(params: {
  baseUrl: string;
  companyId: string;
}): string {
  return [
    "You are running CrewCmd queue dispatch for this workspace.",
    "Use the crewcmd-management skill for all CrewCmd operations.",
    `CrewCmd base URL: ${params.baseUrl}`,
    `Company ID: ${params.companyId}`,
    "",
    "Workflow:",
    "1. List queued tasks for the company.",
    "2. For each queued task with an assigned agent, inspect whether that agent already has an in_progress task.",
    "3. If the assigned agent is free, spawn that agent as a subagent, give it the task context, and instruct it to add a concise task comment acknowledging pickup before moving the task to in_progress.",
    "4. If the assigned agent is already busy, leave the task queued. If there is no queue acknowledgement comment yet, add a concise task comment saying it is queued behind the current task.",
    "5. Do not reassign tasks. Do not create duplicate tasks. Do not notify humans unless the task is blocked or needs a decision.",
    "6. Keep all audit trail on the task as comments.",
    "",
    "If there is nothing to dispatch, stop silently.",
  ].join("\n");
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
    const existing = await client.cronList();
    const job = existing.jobs.find((entry) => entry.name === DISPATCH_JOB_NAME);
    const message = buildQueueDispatchPrompt({
      baseUrl,
      companyId: runtime.companyId,
    });

    if (!job) {
      const created = await client.cronAdd({
        agentId: defaultAgentId,
        name: DISPATCH_JOB_NAME,
        description: "CrewCmd-managed queue dispatcher",
        enabled: true,
        schedule: {
          kind: "every",
          everyMs: 5 * 60 * 1000,
          anchorMs: Date.now(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message,
        },
        delivery: {
          mode: "none",
          channel: "last",
        },
      });

      await upsertRuntimeManagedResource({
        runtimeId: runtime.id,
        companyId: runtime.companyId,
        resourceType: "cron-job",
        resourceKey: DISPATCH_JOB_NAME,
        externalId: created.id,
        targetAgentRef: defaultAgentId,
        payload: created as unknown as Record<string, unknown>,
      });

      return;
    }

    const nextAgentId = defaultAgentId;
    const currentMessage =
      typeof job.payload?.message === "string" ? job.payload.message : "";
    if (job.agentId !== nextAgentId || currentMessage !== message) {
      await client.cronUpdate({
        id: job.id,
        patch: {
          agentId: nextAgentId,
          payload: {
            kind: "agentTurn",
            message,
          },
        },
      });
    }

    await upsertRuntimeManagedResource({
      runtimeId: runtime.id,
      companyId: runtime.companyId,
      resourceType: "cron-job",
      resourceKey: DISPATCH_JOB_NAME,
      externalId: job.id,
      targetAgentRef: job.agentId ?? defaultAgentId,
      payload: job as unknown as Record<string, unknown>,
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
    for (const resource of skillResources) {
      const payload = (resource.payload || {}) as Record<string, unknown>;
      const skillId =
        typeof payload.skillId === "string" ? payload.skillId : null;
      const agentId =
        typeof payload.agentId === "string" ? payload.agentId : resource.targetAgentId;
      if (!skillId || !agentId) continue;

      await uninstallSkillFromOpenClaw({
        skillId,
        agentId,
        companyId: runtime.companyId,
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
