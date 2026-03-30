import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  if (!db) return NextResponse.json([]);

  const { id } = await params;

  try {
    const entries = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.taskId, id));

    entries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    return NextResponse.json(entries);
  } catch (error) {
    console.error("[api/tasks/id/time-entries] GET error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const humanAssignee = body.humanAssignee;

    if (!humanAssignee) {
      return NextResponse.json(
        { error: "humanAssignee is required" },
        { status: 400 }
      );
    }

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const activeEntries = await db
      .select()
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.humanAssignee, humanAssignee),
          isNull(schema.timeEntries.stoppedAt)
        )
      );

    if (activeEntries.length > 0) {
      return NextResponse.json(
        {
          error: "Timer already running",
          activeEntry: activeEntries[0],
        },
        { status: 409 }
      );
    }

    const [entry] = await db
      .insert(schema.timeEntries)
      .values({
        taskId: id,
        humanAssignee,
        startedAt: new Date(),
      })
      .returning();

    await db
      .insert(schema.activityLog)
      .values({
        agentId: humanAssignee,
        actionType: "timer_start",
        description: `Started working on: ${task.title}`,
        metadata: { taskId: id, timeEntryId: entry.id },
      })
      .catch(() => {});

    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id: taskId } = await params;

  try {
    const body = await request.json();
    const { timeEntryId, note } = body;

    if (!timeEntryId) {
      return NextResponse.json(
        { error: "timeEntryId is required" },
        { status: 400 }
      );
    }

    const [entry] = await db
      .select()
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.id, timeEntryId),
          eq(schema.timeEntries.taskId, taskId)
        )
      );

    if (!entry) {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }

    if (entry.stoppedAt) {
      return NextResponse.json(
        { error: "Timer already stopped" },
        { status: 409 }
      );
    }

    const stoppedAt = new Date();
    const durationSeconds = Math.round(
      (stoppedAt.getTime() - new Date(entry.startedAt).getTime()) / 1000
    );

    const updates: Record<string, unknown> = {
      stoppedAt,
      durationSeconds,
    };
    if (note !== undefined) updates.note = note;

    const [updated] = await db
      .update(schema.timeEntries)
      .set(updates)
      .where(eq(schema.timeEntries.id, timeEntryId))
      .returning();

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId));

    const durationLabel = formatDuration(durationSeconds);
    await db
      .insert(schema.activityLog)
      .values({
        agentId: entry.humanAssignee,
        actionType: "time_logged",
        description: `${entry.humanAssignee} worked ${durationLabel} on: ${task?.title ?? "Unknown task"}`,
        metadata: {
          taskId,
          timeEntryId,
          durationSeconds,
          humanAssignee: entry.humanAssignee,
        },
      })
      .catch(() => {});

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}
