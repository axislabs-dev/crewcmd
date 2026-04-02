import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const comments = await db
      .select()
      .from(schema.taskComments)
      .where(eq(schema.taskComments.taskId, id))
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
    const body = await request.json();

    if (!body.content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const [comment] = await db
      .insert(schema.taskComments)
      .values({
        taskId: id,
        agentId: body.agentId || null,
        content: body.content,
      })
      .returning();

    // Log activity for the comment
    if (body.agentId) {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, id));
      await db
        .insert(schema.activityLog)
        .values({
          agentId: body.agentId,
          actionType: "comment",
          description: `Commented on task: ${task?.title ?? id}`,
          metadata: { taskId: id, commentId: comment.id },
        })
        .catch(() => {});
    }

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    console.error("[api/tasks/id/comments] Error:", error);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 400 });
  }
}
