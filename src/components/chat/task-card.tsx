"use client";

import { useState } from "react";

interface TaskCardData {
  id: string;
  shortId?: number;
  title: string;
  status: string;
  priority: string;
  assignedAgentId?: string | null;
  description?: string | null;
}

interface ActionableTask {
  title: string;
  description?: string;
  priority?: string;
  assignedAgentId?: string;
  status?: string;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: "#6b7280",
  inbox: "#8b5cf6",
  queued: "#f59e0b",
  assigned: "#3b82f6",
  in_progress: "#22d3ee",
  review: "#a78bfa",
  done: "#22c55e",
  failed: "#ef4444",
  todo: "#f97316",
  blocked: "#dc2626",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#6b7280",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

export function TaskCard({ task }: { task: TaskCardData }) {
  const statusColor = STATUS_COLORS[task.status] || "#6b7280";
  const priorityColor = PRIORITY_COLORS[task.priority] || "#f59e0b";

  return (
    <div
      className="my-2 rounded-lg border p-3 font-mono text-[12px]"
      style={{
        borderColor: `${statusColor}40`,
        backgroundColor: `${statusColor}0a`,
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: `${statusColor}25`, color: statusColor }}
        >
          {task.status.replace("_", " ")}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: `${priorityColor}25`, color: priorityColor }}
        >
          {task.priority}
        </span>
        {task.assignedAgentId && (
          <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
            → {task.assignedAgentId}
          </span>
        )}
      </div>

      <a
        href={`/tasks?id=${task.id}`}
        className="block font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
      >
        {task.shortId ? `#${task.shortId} ` : ""}
        {task.title}
      </a>

      {task.description && (
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)] line-clamp-2">
          {task.description}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
        <span className="font-mono opacity-60">{task.id.slice(0, 8)}</span>
        <a
          href={`/tasks?id=${task.id}`}
          className="ml-auto text-[var(--accent)] hover:underline"
        >
          View on board →
        </a>
      </div>
    </div>
  );
}

/**
 * A task card variant with a "Create Task" button.
 * Rendered when the agent's response contains an <!--action:create_task:...--> marker.
 * On click, POSTs to /api/chat/create-task and updates to show the created task.
 */
export function CreateTaskCard({ suggestion }: { suggestion: ActionableTask }) {
  const [state, setState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [createdTask, setCreatedTask] = useState<TaskCardData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const priorityColor = PRIORITY_COLORS[suggestion.priority || "medium"] || "#f59e0b";

  async function handleCreate() {
    setState("creating");
    try {
      const res = await fetch("/api/chat/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestion.title,
          description: suggestion.description || null,
          priority: suggestion.priority || "medium",
          assignedAgentId: suggestion.assignedAgentId || null,
          status: suggestion.status || "queued",
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to create task");
      }

      setCreatedTask(result.data);
      setState("created");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create task");
      setState("error");
    }
  }

  if (state === "created" && createdTask) {
    return <TaskCard task={createdTask} />;
  }

  return (
    <div
      className="my-2 rounded-lg border border-dashed p-3 font-mono text-[12px]"
      style={{
        borderColor: `${priorityColor}40`,
        backgroundColor: `${priorityColor}08`,
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)]">
          suggested
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: `${priorityColor}25`, color: priorityColor }}
        >
          {suggestion.priority || "medium"}
        </span>
      </div>

      <p className="font-semibold text-[var(--text-primary)]">{suggestion.title}</p>

      {suggestion.description && (
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)] line-clamp-2">
          {suggestion.description}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {state === "error" && (
          <span className="text-[10px] text-red-400">{errorMsg}</span>
        )}
        <button
          onClick={handleCreate}
          disabled={state === "creating"}
          className="ml-auto rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50"
        >
          {state === "creating" ? "Creating..." : state === "error" ? "Retry" : "Create Task"}
        </button>
      </div>
    </div>
  );
}

/**
 * Extract task card data from message content.
 * Looks for <!--task_card {...json...} --> markers injected by the chat route.
 */
export function extractTaskCards(content: string): {
  segments: Array<
    | { type: "text"; content: string }
    | { type: "task"; task: TaskCardData }
    | { type: "action_create_task"; suggestion: ActionableTask }
  >;
} {
  const regex = /<!--task_card\s+([\s\S]*?)\s*-->|<!--action:create_task:([\s\S]*?)-->/g;
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "task"; task: TaskCardData }
    | { type: "action_create_task"; suggestion: ActionableTask }
  > = [];

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add text before the marker
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      // <!--task_card {...} --> marker
      try {
        const parsed = JSON.parse(match[1]);
        const taskData = parsed.data || parsed;
        if (taskData.id && taskData.title) {
          segments.push({ type: "task", task: taskData });
        } else {
          segments.push({ type: "text", content: match[0] });
        }
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    } else if (match[2]) {
      // <!--action:create_task:{...}--> marker
      try {
        const suggestion = JSON.parse(match[2].trim());
        if (suggestion.title) {
          segments.push({ type: "action_create_task", suggestion });
        } else {
          segments.push({ type: "text", content: match[0] });
        }
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  // If no markers found, return the whole content as text
  if (segments.length === 0) {
    segments.push({ type: "text", content });
  }

  return { segments };
}
