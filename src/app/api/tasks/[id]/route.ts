import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth, requireUserOrRuntimeAuth } from "@/lib/require-auth";
import { isHeartbeatBearerRequest, resolveAccessibleWorkspace } from "@/lib/workspace";
import { createHumanAttentionInbox, type HumanAttentionType } from "@/lib/human-attention";
import { isDeveloperWorkflowRole, type CrewCmdRolePack } from "@/lib/operating-layer";
import {
  verifyTaskCompletion,
  evaluateSupervisorRejection,
} from "@/lib/agent-completion-verification";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveTaskWhere(rawId: string) {
  const tskMatch = rawId.match(/^TSK-(\d+)$/i);
  return tskMatch
    ? eq(schema.tasks.shortId, parseInt(tskMatch[1], 10))
    : eq(schema.tasks.id, rawId);
}

function getOperatingRolePack(agent: typeof schema.agents.$inferSelect | undefined): CrewCmdRolePack | null {
  if (!agent?.runtimeConfig || typeof agent.runtimeConfig !== "object") return null;
  const operatingLayer = (agent.runtimeConfig as Record<string, unknown>).operatingLayer;
  if (!operatingLayer || typeof operatingLayer !== "object") return null;
  const rolePack = (operatingLayer as Record<string, unknown>).rolePack;
  return typeof rolePack === "string" ? (rolePack as CrewCmdRolePack) : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveAssignedAgent(agentRef: string) {
  const whereClause = isUuid(agentRef)
    ? eq(schema.agents.id, agentRef)
    : sql`lower(${schema.agents.callsign}) = ${agentRef.toLowerCase()}`;

  const [agent] = await db!
    .select()
    .from(schema.agents)
    .where(whereClause)
    .limit(1);
  return agent ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;

    // Support TSK-NNNN format lookup
    const whereClause = await resolveTaskWhere(id);

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
  const authError = await requireUserOrRuntimeAuth(request);
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

    const whereClause = await resolveTaskWhere(id);
    const [oldTask] = await db.select().from(schema.tasks).where(whereClause);
    if (!oldTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (await isHeartbeatBearerRequest(request)) {
      const workspace = oldTask.workspaceId
        ? await resolveAccessibleWorkspace({
            request,
            explicitWorkspaceId: oldTask.workspaceId,
            requireExplicitForBearer: true,
          })
        : null;
      if (!workspace) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const nextAssignedAgentId = body.assignedAgentId ?? oldTask.assignedAgentId ?? null;
    const assignedAgent = nextAssignedAgentId
      ? await resolveAssignedAgent(nextAssignedAgentId)
      : null;
    const rolePack = getOperatingRolePack(assignedAgent ?? undefined);
    const nextPrUrl = body.prUrl ?? oldTask.prUrl ?? null;

    // Agent completion verification gate
    const targetStatus = body.status as string | undefined;
    if (
      (targetStatus === "review" || targetStatus === "done") &&
      nextAssignedAgentId
    ) {
      const validationResult = await verifyTaskCompletion(id, assignedAgent?.id ?? null);
      if (!validationResult.valid) {
        const rejection = evaluateSupervisorRejection(validationResult, targetStatus);
        if (rejection.rejected) {
          return NextResponse.json(
            {
              error: rejection.reason,
              retrySuggestion: rejection.retrySuggestion,
              validationErrors: validationResult.errors,
              validationWarnings: validationResult.warnings,
            },
            { status: 400 }
          );
        }
      }

      // Warnings are logged but don't block
      if (validationResult.warnings.length > 0) {
        console.warn(
          "[api/tasks/id] Completion verification warnings:",
          validationResult.warnings
        );
      }
    }

    if (
      body.status === "review" &&
      isDeveloperWorkflowRole(rolePack) &&
      (!nextPrUrl || (typeof nextPrUrl === "string" && nextPrUrl.trim().length === 0))
    ) {
      return NextResponse.json(
        { error: "Developer and reviewer tasks require prUrl before moving to review" },
        { status: 400 }
      );
    }

    const [task] = await db.update(schema.tasks).set(updates).where(whereClause).returning();

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

    // Send Slack DM when humanAssignee changes
    if (body.humanAssignee && oldTask && body.humanAssignee !== oldTask.humanAssignee) {
      // Log the activity
      await db.insert(schema.activityLog).values({
        agentId: "system",
        actionType: "human_assigned",
        description: `Assigned to ${body.humanAssignee}: ${task.title}`,
        metadata: { taskId: task.id, humanAssignee: body.humanAssignee },
      }).catch(() => {});

      // Send Slack notification if configured
      const slackToken = process.env.SLACK_BOT_TOKEN;
      const slackChannel = process.env.SLACK_NOTIFICATION_CHANNEL;
      if (slackToken && slackChannel) {
        try {
          const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${slackToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: slackChannel,
              text: `🔔 *New Task Assigned to ${body.humanAssignee}*\n\n*${task.title}*\n${task.description || "No description"}\n\nView in CrewCmd: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/tasks`,
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

    const inferredAttentionType: HumanAttentionType | null =
      typeof body.humanAttentionType === "string"
        ? (body.humanAttentionType as HumanAttentionType)
        : body.status === "blocked"
          ? "blocker"
          : body.status === "review"
            ? "review"
            : null;

    if (inferredAttentionType) {
      await createHumanAttentionInbox({
        taskId: task.id,
        fromAgentId: body.agentId || task.assignedAgentId || null,
        type: inferredAttentionType,
        title:
          body.humanAttentionTitle ||
          `${inferredAttentionType.toUpperCase()}: ${task.title}`,
        body:
          body.humanAttentionBody ||
          (inferredAttentionType === "review"
            ? `Task ${task.title} is ready for review.`
            : `Task ${task.title} needs human attention.`),
        priority:
          body.humanAttentionPriority ||
          (inferredAttentionType === "blocker" ? "high" : "normal"),
        relatedAgents: task.assignedAgentId ? [task.assignedAgentId] : undefined,
      }).catch(() => null);
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
  const whereClause = await resolveTaskWhere(id);
  const [task] = await db.delete(schema.tasks).where(whereClause).returning();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}
