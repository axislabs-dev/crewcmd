import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { uploadImage } from "@/lib/image-storage";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;

    // Support TSK-NNNN format lookup
    const tskMatch = id.match(/^TSK-(\d+)$/i);
    const whereClause = tskMatch
      ? eq(schema.tasks.shortId, parseInt(tskMatch[1], 10))
      : eq(schema.tasks.id, id);

    const [task] = await db.select().from(schema.tasks).where(whereClause);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Enrich with project context so agents don't need a second API call
    let projectContext: { context: string | null; contextUpdatedAt: Date | null; contextUpdatedBy: string | null } | null = null;
    if (task.projectId) {
      const [project] = await db
        .select({
          context: schema.projects.context,
          contextUpdatedAt: schema.projects.contextUpdatedAt,
          contextUpdatedBy: schema.projects.contextUpdatedBy,
        })
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId));
      if (project) projectContext = project;
    }

    return NextResponse.json({
      ...task,
      projectContext: projectContext?.context ?? null,
      projectContextUpdatedAt: projectContext?.contextUpdatedAt ?? null,
      projectContextUpdatedBy: projectContext?.contextUpdatedBy ?? null,
      images: task.images || [],
    });
  } catch (error) {
    console.error("[api/tasks/id] Database error:", error);
    return NextResponse.json({ error: "Database connection failed" }, { status: 503 });
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

  const { id } = await params;

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.assignedAgentId !== undefined) updates.assignedAgentId = body.assignedAgentId;
    if (body.humanAssignee !== undefined) updates.humanAssignee = body.humanAssignee;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.prUrl !== undefined) updates.prUrl = body.prUrl;
    if (body.prStatus !== undefined) updates.prStatus = body.prStatus;
    if (body.branch !== undefined) updates.branch = body.branch;
    if (body.repo !== undefined) updates.repo = body.repo;
    if (body.reviewNotes !== undefined) updates.reviewNotes = body.reviewNotes;
    if (body.reviewCycleCount !== undefined) updates.reviewCycleCount = body.reviewCycleCount;
    if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex;
    if (body.source !== undefined) updates.source = body.source;
    if (body.images !== undefined) updates.images = body.images;

    const [oldTask] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    const [task] = await db.update(schema.tasks).set(updates).where(eq(schema.tasks.id, id)).returning();

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (body.status && oldTask && body.status !== oldTask.status) {
      const statusLabels: Record<string, string> = {
        inbox: "moved to inbox",
        queued: "queued for dispatch",
        in_progress: "started working",
        review: "submitted for review",
        done: "marked as complete",
      };
      const agent = task.assignedAgentId || body.agentId || "system";
      await db.insert(schema.activityLog).values({
        agentId: agent,
        actionType: `task_${body.status}`,
        description: `${statusLabels[body.status] || body.status}: ${task.title}`,
        metadata: { taskId: task.id, from: oldTask.status, to: body.status },
      }).catch(() => {});
    }

    if (body.assignedAgentId && oldTask && body.assignedAgentId !== oldTask.assignedAgentId) {
      await db.insert(schema.activityLog).values({
        agentId: body.assignedAgentId,
        actionType: "task_assigned",
        description: `Assigned to task: ${task.title}`,
        metadata: { taskId: task.id },
      }).catch(() => {});
    }

    // Send Slack DM when humanAssignee is set
    if (body.humanAssignee && oldTask && body.humanAssignee !== oldTask.humanAssignee && body.humanAssignee === "roger") {
      // Log the activity
      await db.insert(schema.activityLog).values({
        agentId: "system",
        actionType: "human_assigned",
        description: `Assigned to Roger: ${task.title}`,
        metadata: { taskId: task.id, humanAssignee: body.humanAssignee },
      }).catch(() => {});

      // Send Slack DM to Roger
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (slackToken) {
        try {
          const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${slackToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: "U09DM3RM9DX",
              text: `🔔 *New Task Assigned to You*\n\n*${task.title}*\n${task.description || "No description"}\n\nView in Mission Control: https://mission-control-blond-sigma.vercel.app/tasks`,
            }),
          });
          if (!slackRes.ok) {
            console.error("[api/tasks/id] Slack notification failed:", await slackRes.text());
          }
        } catch (slackError) {
          console.error("[api/tasks/id] Slack notification error:", slackError);
        }
      }
    }

    return NextResponse.json(task);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const [task] = await db.delete(schema.tasks).where(eq(schema.tasks.id, id)).returning();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}

