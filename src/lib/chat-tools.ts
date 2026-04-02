/**
 * Chat-to-task bridge: tool definitions for prompt-based function calling.
 *
 * The chat agent sees these schemas in its system prompt and emits
 * ```tool_call\n{"tool":"createTask","args":{...}}\n```
 * blocks that the chat route intercepts and executes.
 */

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export const chatTools: ChatToolDefinition[] = [
  {
    name: "createTask",
    description:
      "Create a new task on the task board. Use when the user describes work that needs doing, requests a task be created, or you identify actionable work.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        description: {
          type: "string",
          description: "Detailed description of what needs to be done",
        },
        priority: {
          type: "string",
          description: "Task priority level",
          enum: ["low", "medium", "high", "critical"],
        },
        assignedAgentId: {
          type: "string",
          description: "Agent callsign to assign the task to (optional)",
        },
        status: {
          type: "string",
          description: "Initial task status (defaults to queued)",
          enum: [
            "backlog",
            "inbox",
            "queued",
            "assigned",
            "in_progress",
            "review",
            "done",
            "todo",
          ],
        },
      },
      required: ["title"],
    },
  },
  {
    name: "listTasks",
    description:
      "List tasks from the task board with optional filters. Use when the user asks about current tasks, workload, or task status.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status",
          enum: [
            "backlog",
            "inbox",
            "queued",
            "assigned",
            "in_progress",
            "review",
            "done",
            "failed",
            "todo",
            "blocked",
          ],
        },
        assignedAgentId: {
          type: "string",
          description: "Filter by assigned agent callsign",
        },
        priority: {
          type: "string",
          description: "Filter by priority",
          enum: ["low", "medium", "high", "critical"],
        },
      },
      required: [],
    },
  },
  {
    name: "updateTask",
    description:
      "Update an existing task. Use when the user wants to change a task's status, reassign it, or modify its details.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "UUID of the task to update",
        },
        status: {
          type: "string",
          description: "New status",
          enum: [
            "backlog",
            "inbox",
            "queued",
            "assigned",
            "in_progress",
            "review",
            "done",
            "failed",
            "todo",
            "blocked",
          ],
        },
        assignedAgentId: {
          type: "string",
          description: "New assigned agent callsign",
        },
        priority: {
          type: "string",
          description: "New priority",
          enum: ["low", "medium", "high", "critical"],
        },
        description: {
          type: "string",
          description: "Updated description",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "getTask",
    description:
      "Get full details of a specific task by ID. Use when the user asks about a particular task.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "UUID of the task to retrieve",
        },
      },
      required: ["taskId"],
    },
  },
];
