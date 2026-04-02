"use client";

interface TaskCardData {
  id: string;
  shortId?: number;
  title: string;
  status: string;
  priority: string;
  assignedAgentId?: string | null;
  description?: string | null;
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
 * Extract task card data from message content.
 * Looks for <!--task_card {...json...} --> markers injected by the chat route.
 */
export function extractTaskCards(content: string): {
  segments: Array<{ type: "text"; content: string } | { type: "task"; task: TaskCardData }>;
} {
  const regex = /<!--task_card\s+([\s\S]*?)\s*-->/g;
  const segments: Array<
    { type: "text"; content: string } | { type: "task"; task: TaskCardData }
  > = [];

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add text before the marker
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }

    // Try to parse the task JSON
    try {
      const parsed = JSON.parse(match[1]);
      // The result may be wrapped in { success: true, data: {...} }
      const taskData = parsed.data || parsed;
      if (taskData.id && taskData.title) {
        segments.push({ type: "task", task: taskData });
      } else {
        // Invalid task data, keep as text
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      segments.push({ type: "text", content: match[0] });
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
