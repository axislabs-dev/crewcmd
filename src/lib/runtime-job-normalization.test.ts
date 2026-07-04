import { describe, expect, it } from "vitest";
import { normalizeHermesJobForSchedule } from "./runtime-job-normalization";

describe("normalizeHermesJobForSchedule", () => {
  it("maps Hermes cron jobs into the schedule list shape", () => {
    const job = normalizeHermesJobForSchedule({
      id: "job_123",
      prompt: "Check the queue",
      cron: "0 9 * * *",
      timezone: "UTC",
      status: "ok",
      next_run_at: "2026-07-05T09:00:00.000Z",
      last_run_at: "2026-07-04T09:00:00.000Z",
      session_id: "sess_123",
      model: "hermes-agent",
    });

    expect(job).toEqual({
      id: "job_123",
      name: "Check the queue",
      description: "Check the queue",
      enabled: true,
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      sessionTarget: "sess_123",
      payload: {
        prompt: "Check the queue",
        model: "hermes-agent",
        session_id: "sess_123",
      },
      state: {
        lastRunStatus: "ok",
        lastRunAtMs: Date.parse("2026-07-04T09:00:00.000Z"),
        nextRunAtMs: Date.parse("2026-07-05T09:00:00.000Z"),
      },
    });
  });

  it("preserves native schedule, payload, and state objects when Hermes returns them", () => {
    const job = normalizeHermesJobForSchedule({
      job_id: "job_native",
      name: "Native",
      enabled: false,
      schedule: { kind: "every", everyMs: 60000 },
      payload: { input: "Native payload" },
      state: { lastRunStatus: "paused" },
    });

    expect(job).toMatchObject({
      id: "job_native",
      name: "Native",
      enabled: false,
      schedule: { kind: "every", everyMs: 60000 },
      payload: { input: "Native payload" },
      state: { lastRunStatus: "paused" },
    });
  });

  it("ignores malformed Hermes jobs without a stable id", () => {
    expect(normalizeHermesJobForSchedule({ prompt: "Missing id" })).toBeNull();
    expect(normalizeHermesJobForSchedule(null)).toBeNull();
  });
});
