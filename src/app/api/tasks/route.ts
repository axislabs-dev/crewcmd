import { NextRequest, NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import type { TaskStatus, TaskPriority } from "@/lib/data";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TaskStatus | null;
    const agentId = searchParams.get("agentId");
    const priority = searchParams.get("priority") as TaskPriority | null;
    const unassigned = searchParams.get("unassigned");
    const excludeHumanAssignee = searchParams.get("excludeHumanAssignee") === "true";
    const sinceParam = searchParams.get("since"); // ISO timestamp or Unix ms

    let result = await withRetry(() => db!.select().from(schema.tasks));

    if (status) {
      result = result.filter((t) => t.status === status);
    }
    if (agentId) {
      result = result.filter((t) => t.assignedAgentId === agentId);
    }
    if (priority) {
      result = result.filter((t) => t.priority === priority);
    }
    if (unassigned === "true") {
      result = result.filter((t) => !t.assignedAgentId);
    }
    if (excludeHumanAssignee) {
      result = result.filter((t) => !t.humanAssignee);
    }
    if (sinceParam) {
      const sinceMs = isNaN(Number(sinceParam))
        ? new Date(sinceParam).getTime()
        : Number(sinceParam);
      if (!isNaN(sinceMs)) {
        result = result.filter((t) => {
          const updated = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
          return updated >= sinceMs;
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/tasks] Database error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // Dedup: if errorHash provided, check for existing non-done task
    if (body.errorHash) {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.errorHash, body.errorHash),
            ne(schema.tasks.status, "done")
          )
        );
      if (existing) {
        return NextResponse.json({ existing }, { status: 409 });
      }
    }

    const [task] = await db.insert(schema.tasks).values({
      title: body.title,
      description: body.description || null,
      status: body.status || "inbox",
      priority: body.priority || "medium",
      assignedAgentId: body.assignedAgentId || null,
      humanAssignee: body.humanAssignee || null,
      projectId: body.projectId || null,
      prUrl: body.prUrl || null,
      prStatus: body.prStatus || null,
      branch: body.branch || null,
      repo: body.repo || null,
      reviewNotes: body.reviewNotes || null,
      reviewCycleCount: body.reviewCycleCount || 0,
      source: body.source || "manual",
      errorHash: body.errorHash || null,
      createdBy: body.createdBy || null,
    }).returning();

    // Log task creation activity
    const creator = body.createdBy || body.assignedAgentId || "system";
    await db.insert(schema.activityLog).values({
      agentId: creator,
      actionType: "create",
      description: `Created task: ${task.title}`,
      metadata: { taskId: task.id, priority: task.priority, status: task.status },
    }).catch(() => {});

    return NextResponse.json(task, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
