import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import {
  companyMembers,
  inboxMessages,
  tasks,
  users,
  workspaces,
} from "@/db/schema";

export type HumanAttentionType = "blocker" | "question" | "review" | "decision";

export async function getTaskWorkspaceScope(taskId: string) {
  if (!db) throw new Error("Database not initialized");

  const [task] = await withRetry(() =>
    db!
      .select({
        id: tasks.id,
        title: tasks.title,
        workspaceId: tasks.workspaceId,
        companyId: tasks.companyId,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
  );

  return task ?? null;
}

export async function createHumanAttentionInbox(params: {
  taskId: string;
  fromAgentId?: string | null;
  type: HumanAttentionType;
  title: string;
  body: string;
  priority?: "critical" | "high" | "normal" | "low";
  relatedAgents?: string[];
}) {
  if (!db) throw new Error("Database not initialized");

  const taskScope = await getTaskWorkspaceScope(params.taskId);
  if (!taskScope?.workspaceId) return null;

  const [workspace] = await withRetry(() =>
    db!
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, taskScope.workspaceId!))
      .limit(1)
  );
  if (!workspace) return null;

  let toUserId = workspace.ownerUserId ?? null;

  if (!toUserId && workspace.companyId) {
    const companyId = workspace.companyId;
    const [member] = await withRetry(() =>
      db!
        .select({
          userId: companyMembers.userId,
          role: companyMembers.role,
          email: users.email,
        })
        .from(companyMembers)
        .innerJoin(users, eq(companyMembers.userId, users.id))
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, "owner")
          )
        )
        .limit(1)
    );

    if (member?.userId) {
      toUserId = member.userId;
    }
  }

  if (!toUserId && workspace.companyId) {
    const companyId = workspace.companyId;
    const [member] = await withRetry(() =>
      db!
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, "admin")
          )
        )
        .limit(1)
    );
    toUserId = member?.userId ?? null;
  }

  if (!toUserId) return null;

  const inboxType = params.type === "review" || params.type === "decision"
    ? "approval"
    : params.type;

  const [message] = await withRetry(() =>
    db!
      .insert(inboxMessages)
      .values({
        workspaceId: workspace.id,
        companyId: workspace.companyId ?? taskScope.companyId ?? null,
        fromAgentId: params.fromAgentId ?? "system",
        toUserId,
        type: inboxType,
        priority: params.priority ?? (params.type === "blocker" ? "high" : "normal"),
        title: params.title,
        body: params.body,
        context: {
          taskId: params.taskId,
          relatedAgents: params.relatedAgents,
          metadata: {
            humanAttentionType: params.type,
          },
        },
      })
      .returning()
  );

  return message ?? null;
}
