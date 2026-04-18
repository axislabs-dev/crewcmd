import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes, cronJobs } from "@/db/schema";
import { getAgentAccessContext, buildRuntimeReadWhere } from "@/lib/agent-access";
import { GatewayClient, resolveDeviceIdentity, type GatewayCronJob } from "./gateway-client";
import { getWorkspaceAccessContext, getWorkspaceById } from "./workspace";

function humanSchedule(sched: Record<string, unknown>): string {
  if (!sched || typeof sched !== "object") return "unknown";
  if (sched.kind === "every" && sched.everyMs) {
    const ms = sched.everyMs as number;
    if (ms < 60000) return `every ${ms / 1000}s`;
    if (ms < 3600000) return `every ${ms / 60000}m`;
    if (ms < 86400000) return `every ${ms / 3600000}h`;
    return `every ${ms / 86400000}d`;
  }
  if (sched.kind === "cron" && sched.expr) {
    return `cron: ${sched.expr}${sched.tz ? ` (${sched.tz})` : ""}`;
  }
  if (sched.kind === "at") return `at ${sched.at ?? "unknown"}`;
  return "unknown";
}

export async function resolvePrimaryReadableRuntimeForActiveWorkspace() {
  const [access, workspaceAccess] = await Promise.all([
    getAgentAccessContext(),
    getWorkspaceAccessContext(),
  ]);
  if (!db) return null;

  const where = buildRuntimeReadWhere(access);
  if (!where) return null;

  const activeWorkspace = workspaceAccess.activeWorkspaceId
    ? await getWorkspaceById(workspaceAccess.activeWorkspaceId)
    : null;

  if (activeWorkspace?.type === "personal" && access.userId) {
    const primary = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(
          and(
            eq(companyRuntimes.ownerType, "user"),
            eq(companyRuntimes.ownerUserId, access.userId!),
            eq(companyRuntimes.isPrimary, true),
            where
          )
        )
        .limit(1)
    );
    if (primary[0]) return primary[0];

    const fallback = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(
          and(
            eq(companyRuntimes.ownerType, "user"),
            eq(companyRuntimes.ownerUserId, access.userId!),
            where
          )
        )
        .limit(1)
    );

    return fallback[0] ?? null;
  }

  const activeCompanyId = activeWorkspace?.companyId ?? access.activeCompanyId;
  if (!activeCompanyId) return null;

  const primary = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(
        and(
          eq(companyRuntimes.companyId, activeCompanyId),
          eq(companyRuntimes.isPrimary, true),
          where
        )
      )
      .limit(1)
  );
  if (primary[0]) return primary[0];

  const fallback = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(and(eq(companyRuntimes.companyId, activeCompanyId), where))
      .limit(1)
  );

  return fallback[0] ?? null;
}

export async function listCronJobsFromRuntime() {
  const runtime = await resolvePrimaryReadableRuntimeForActiveWorkspace();
  if (!runtime) {
    return { runtime: null, jobs: [] as GatewayCronJob[] };
  }

  const meta = (runtime.metadata || {}) as Record<string, unknown>;
  const deviceKeyPem =
    typeof meta.devicePrivateKeyPem === "string" ? meta.devicePrivateKeyPem : undefined;
  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    const result = await client.cronList();
    return {
      runtime,
      jobs: Array.isArray(result.jobs) ? result.jobs : [],
    };
  } finally {
    client.close();
  }
}

export async function syncCronJobsFromRuntime() {
  if (!db) throw new Error("Database not configured");

  const { runtime, jobs } = await listCronJobsFromRuntime();
  if (!runtime) {
    const result = await withRetry(() => db!.delete(cronJobs));
    return {
      upserted: 0,
      deleted: result.rowCount ?? 0,
      runtimeId: null as string | null,
    };
  }

  const incomingIds = jobs.map((job) => job.id);

  for (const job of jobs) {
    const state = (job.state ?? {}) as Record<string, unknown>;
    await withRetry(() =>
      db!.insert(cronJobs).values({
        id: job.id,
        name: job.name,
        schedule: humanSchedule((job.schedule ?? {}) as Record<string, unknown>),
        status: (state.lastRunStatus as string) ?? (state.lastStatus as string) ?? "ok",
        enabled: job.enabled !== false,
        lastRun: state.lastRunAtMs ? new Date(state.lastRunAtMs as number) : null,
        nextRun: state.nextRunAtMs ? new Date(state.nextRunAtMs as number) : null,
        target: (job.sessionTarget ?? null) as string | null,
        raw: job as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: cronJobs.id,
        set: {
          name: sql`excluded.name`,
          schedule: sql`excluded.schedule`,
          status: sql`excluded.status`,
          enabled: sql`excluded.enabled`,
          lastRun: sql`excluded.last_run`,
          nextRun: sql`excluded.next_run`,
          target: sql`excluded.target`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
    );
  }

  let deleted = 0;
  if (incomingIds.length > 0) {
    const result = await withRetry(() =>
      db!.delete(cronJobs).where(notInArray(cronJobs.id, incomingIds))
    );
    deleted = result.rowCount ?? 0;
  }

  return { upserted: jobs.length, deleted, runtimeId: runtime.id };
}
