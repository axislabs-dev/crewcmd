import type { GatewayCronJob } from "./gateway-client";

const DISABLED_STATUSES = new Set(["disabled", "paused", "stopped", "suspended"]);

export function normalizeHermesJobForSchedule(job: unknown): GatewayCronJob | null {
  if (!isRecord(job)) return null;

  const id =
    normalizeString(job.id) ??
    normalizeString(job.job_id) ??
    normalizeString(job.jobId) ??
    normalizeString(job.name) ??
    normalizeString(job.title);
  if (!id) return null;

  const status = normalizeString(job.status);

  return {
    id,
    name: normalizeString(job.name) ?? normalizeString(job.title) ?? normalizeString(job.prompt) ?? id,
    description: normalizeString(job.description) ?? normalizeString(job.prompt) ?? undefined,
    enabled: normalizeBoolean(job.enabled) ?? !DISABLED_STATUSES.has((status ?? "").toLowerCase()),
    schedule: normalizeHermesSchedule(job),
    sessionTarget:
      normalizeString(job.sessionTarget) ??
      normalizeString(job.session_target) ??
      normalizeString(job.sessionId) ??
      normalizeString(job.session_id) ??
      undefined,
    payload: normalizeHermesPayload(job),
    state: normalizeHermesState(job, status),
  };
}

function normalizeHermesSchedule(job: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(job.schedule)) return job.schedule;

  const cron =
    normalizeString(job.cron) ??
    normalizeString(job.cron_expression) ??
    normalizeString(job.cronExpression) ??
    normalizeString(job.schedule);
  if (cron) {
    const schedule: Record<string, unknown> = { kind: "cron", expr: cron };
    const timezone = normalizeString(job.timezone) ?? normalizeString(job.tz);
    if (timezone) schedule.tz = timezone;
    return schedule;
  }

  const everyMs = normalizeNumber(job.everyMs) ?? normalizeNumber(job.every_ms) ?? normalizeNumber(job.interval_ms);
  if (everyMs !== null) return { kind: "every", everyMs };

  const at = normalizeString(job.at) ?? normalizeString(job.runAt) ?? normalizeString(job.run_at);
  if (at) return { kind: "at", at };

  return { kind: "unknown" };
}

function normalizeHermesPayload(job: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(job.payload)) return job.payload;

  const payload: Record<string, unknown> = {};
  for (const key of ["prompt", "input", "model", "session_id", "sessionId"]) {
    if (job[key] !== undefined) payload[key] = job[key];
  }
  return payload;
}

function normalizeHermesState(job: Record<string, unknown>, status: string | null): Record<string, unknown> {
  const state = isRecord(job.state) ? { ...job.state } : {};
  if (status && state.lastRunStatus === undefined) state.lastRunStatus = status;

  const lastRunAtMs =
    normalizeTimestampMs(job.lastRunAtMs) ??
    normalizeTimestampMs(job.last_run_at_ms) ??
    normalizeTimestampMs(job.lastRunAt) ??
    normalizeTimestampMs(job.last_run_at);
  if (lastRunAtMs !== null && state.lastRunAtMs === undefined) state.lastRunAtMs = lastRunAtMs;

  const nextRunAtMs =
    normalizeTimestampMs(job.nextRunAtMs) ??
    normalizeTimestampMs(job.next_run_at_ms) ??
    normalizeTimestampMs(job.nextRunAt) ??
    normalizeTimestampMs(job.next_run_at);
  if (nextRunAtMs !== null && state.nextRunAtMs === undefined) state.nextRunAtMs = nextRunAtMs;

  return state;
}

function normalizeTimestampMs(value: unknown): number | null {
  const numeric = normalizeNumber(value);
  if (numeric !== null) return numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = normalizeString(value);
  if (!date) return null;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
