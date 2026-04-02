/**
 * Chat-to-task bridge: executes tool calls against the database directly.
 *
 * Each handler receives parsed args and returns a JSON-serializable result.
 */

import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function createTask(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  const title = args.title as string;
  if (!title) return { success: false, error: "title is required" };

  const [task] = await withRetry(() =>
    db!.insert(schema.tasks).values({
      title,
      description: (args.description as string) || null,
      status: (args.status as string as typeof schema.tasks.$inferInsert["status"]) || "queued",
      priority: (args.priority as string as typeof schema.tasks.$inferInsert["priority"]) || "medium",
      assignedAgentId: (args.assignedAgentId as string) || null,
      source: "manual",
      createdBy: "chat",
    }).returning()
  );

  // Fire-and-forget activity log
  db.insert(schema.activityLog).values({
    agentId: (args.assignedAgentId as string) || "chat",
    actionType: "create",
    description: `Created task from chat: ${task.title}`,
    metadata: { taskId: task.id, priority: task.priority, status: task.status },
  }).catch(() => {});

  return { success: true, data: task };
}

async function listTasks(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  let result = await withRetry(() => db!.select().from(schema.tasks));

  if (args.status) {
    result = result.filter((t) => t.status === args.status);
  }
  if (args.assignedAgentId) {
    result = result.filter((t) => t.assignedAgentId === args.assignedAgentId);
  }
  if (args.priority) {
    result = result.filter((t) => t.priority === args.priority);
  }

  // Return a summary to keep token count reasonable
  const summary = result.map((t) => ({
    id: t.id,
    shortId: t.shortId,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignedAgentId: t.assignedAgentId,
  }));

  return { success: true, data: { count: summary.length, tasks: summary } };
}

async function updateTask(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  const taskId = args.taskId as string;
  if (!taskId) return { success: false, error: "taskId is required" };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (args.status) updates.status = args.status;
  if (args.assignedAgentId) updates.assignedAgentId = args.assignedAgentId;
  if (args.priority) updates.priority = args.priority;
  if (args.description) updates.description = args.description;

  if (Object.keys(updates).length === 1) {
    return { success: false, error: "No fields to update" };
  }

  const [updated] = await withRetry(() =>
    db!
      .update(schema.tasks)
      .set(updates)
      .where(eq(schema.tasks.id, taskId))
      .returning()
  );

  if (!updated) return { success: false, error: `Task ${taskId} not found` };

  return { success: true, data: updated };
}

async function getTask(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  const taskId = args.taskId as string;
  if (!taskId) return { success: false, error: "taskId is required" };

  const [task] = await withRetry(() =>
    db!.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))
  );

  if (!task) return { success: false, error: `Task ${taskId} not found` };

  return { success: true, data: task };
}

async function addComment(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  const taskId = args.taskId as string;
  if (!taskId) return { success: false, error: "taskId is required" };

  const content = args.content as string;
  if (!content) return { success: false, error: "content is required" };

  const agentId = (args.agentId as string) || null;

  const [comment] = await withRetry(() =>
    db!.insert(schema.taskComments).values({
      taskId,
      agentId,
      content,
    }).returning()
  );

  return { success: true, data: comment };
}

async function getMyTasks(args: Record<string, unknown>): Promise<ToolResult> {
  if (!db) return { success: false, error: "Database not configured" };

  const agentId = args.agentId as string;
  if (!agentId) return { success: false, error: "agentId is required" };

  const result = await withRetry(() =>
    db!.select().from(schema.tasks).where(eq(schema.tasks.assignedAgentId, agentId))
  );

  const summary = result.map((t) => ({
    id: t.id,
    shortId: t.shortId,
    title: t.title,
    status: t.status,
    priority: t.priority,
  }));

  return { success: true, data: { count: summary.length, tasks: summary } };
}

const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  createTask,
  listTasks,
  updateTask,
  getTask,
  addComment,
  getMyTasks,
};

/**
 * Execute a parsed tool call and return the result as a JSON string.
 */
export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const handler = handlers[toolCall.tool];
  if (!handler) {
    return JSON.stringify({ success: false, error: `Unknown tool: ${toolCall.tool}` });
  }

  try {
    const result = await handler(toolCall.args);
    return JSON.stringify(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[chat-tool-executor] Error executing ${toolCall.tool}:`, msg);
    return JSON.stringify({ success: false, error: msg });
  }
}

/**
 * Parse a tool_call code block from agent output.
 * Expected format: ```tool_call\n{"tool":"createTask","args":{...}}\n```
 * Returns null if no valid tool call found.
 */
export function parseToolCall(text: string): ToolCall | null {
  const match = text.match(/```tool_call\s*\n([\s\S]*?)\n```/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (typeof parsed.tool === "string" && parsed.args && typeof parsed.args === "object") {
      return parsed as ToolCall;
    }
  } catch {
    // Malformed JSON
  }

  return null;
}
