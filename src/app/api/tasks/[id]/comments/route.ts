import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth, requireUserOrRuntimeAuth } from "@/lib/require-auth";
import { createHumanAttentionInbox, type HumanAttentionType } from "@/lib/human-attention";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveTaskId(rawId: string): Promise<string | null> {
  if (!db) return null;

  const tskMatch = rawId.match(/^TSK-(\d+)$/i);
  if (!tskMatch) return rawId;

  const [task] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.shortId, parseInt(tskMatch[1], 10)))
    .limit(1);

  return task?.id ?? null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const resolvedTaskId = await resolveTaskId(id);
    if (!resolvedTaskId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const comments = await db
      .select()
      .from(schema.taskComments)
      .where(eq(schema.taskComments.taskId, resolvedTaskId))
      .orderBy(desc(schema.taskComments.createdAt));

    return NextResponse.json(comments);
  } catch (error) {
    console.error("[api/tasks/id/comments] Database error:", error);
    return NextResponse.json({ error: "Database connection failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const resolvedTaskId = await resolveTaskId(id);
    if (!resolvedTaskId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const body = await request.json();

    if (!body.content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const [comment] = await db
      .insert(schema.taskComments)
      .values({
        taskId: resolvedTaskId,
        agentId: body.agentId || null,
        content: body.content,
      })
      .returning();

    // Log activity for the comment
    if (body.agentId) {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, resolvedTaskId));
      await db
        .insert(schema.activityLog)
        .values({
          agentId: body.agentId,
          actionType: "comment",
          description: `Commented on task: ${task?.title ?? resolvedTaskId}`,
          metadata: { taskId: resolvedTaskId, commentId: comment.id },
        })
        .catch(() => {});
    }

    const attentionType =
      typeof body.humanAttentionType === "string"
        ? (body.humanAttentionType as HumanAttentionType)
        : null;
    if (attentionType) {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, resolvedTaskId))
        .limit(1);
      if (task) {
        await createHumanAttentionInbox({
          taskId: resolvedTaskId,
          fromAgentId: body.agentId || task.assignedAgentId || null,
          type: attentionType,
          title: body.humanAttentionTitle || `${attentionType.toUpperCase()}: ${task.title}`,
          body:
            body.humanAttentionBody ||
            body.content,
          priority: body.humanAttentionPriority || (attentionType === "blocker" ? "high" : "normal"),
          relatedAgents: task.assignedAgentId ? [task.assignedAgentId] : undefined,
        }).catch(() => null);
      }
    }

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    console.error("[api/tasks/id/comments] Error:", error);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 400 });
  }
}
