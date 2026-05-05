"use client";

export type ExecutionProgressEvent = {
  type?: "chat_progress";
  event: string;
  at?: string;
  elapsedMs?: number;
  runId?: string;
  error?: string;
  activeTool?: {
    id?: string;
    name?: string;
    status?: string | null;
    detail?: string;
  };
};

type ExecutionPhase = "run-started" | "thinking" | "tool" | "waiting" | "completed" | "error";

interface ExecutionProgressPanelProps {
  progress: ExecutionProgressEvent | null;
  isLoading: boolean;
  hasStreamingContent: boolean;
  agentColor: string;
}

const PHASES: Array<{ phase: ExecutionPhase; label: string }> = [
  { phase: "run-started", label: "Run started" },
  { phase: "thinking", label: "Thinking" },
  { phase: "tool", label: "Tool" },
  { phase: "waiting", label: "Waiting" },
  { phase: "completed", label: "Completed" },
  { phase: "error", label: "Error" },
];

function phaseFromProgress(
  progress: ExecutionProgressEvent | null,
  isLoading: boolean,
  hasStreamingContent: boolean,
): ExecutionPhase | null {
  if (!progress) {
    if (!isLoading) return null;
    return hasStreamingContent ? "thinking" : "run-started";
  }

  const event = progress.event.toLowerCase();
  if (event.includes("error") || event.includes("abort")) return "error";
  if (event.includes("tool")) return "tool";
  if (event.includes("completed") || event.includes("complete")) return "completed";
  if (event.includes("waiting") || event.includes("heartbeat")) return "waiting";
  if (event.includes("thinking") || event.includes("gateway_send")) return "thinking";
  if (event.includes("started") || event.includes("start")) return "run-started";

  if (isLoading) return hasStreamingContent ? "thinking" : "run-started";
  return null;
}

function formatElapsed(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function labelFromProgress(progress: ExecutionProgressEvent | null, phase: ExecutionPhase) {
  const toolName = progress?.activeTool?.name;
  const toolStatus = progress?.activeTool?.status;

  if (phase === "tool" && toolName) {
    if (toolStatus === "result" || progress?.event === "tool_completed") return `Completed ${toolName}`;
    if (toolStatus === "start" || progress?.event === "tool_started") return `Calling ${toolName}`;
    return `Using ${toolName}`;
  }

  return PHASES.find((item) => item.phase === phase)?.label ?? "Working";
}

export function ExecutionProgressPanel({
  progress,
  isLoading,
  hasStreamingContent,
  agentColor,
}: ExecutionProgressPanelProps) {
  const phase = phaseFromProgress(progress, isLoading, hasStreamingContent);
  if (!phase) return null;

  const elapsed = formatElapsed(progress?.elapsedMs);
  const activeIndex = PHASES.findIndex((item) => item.phase === phase);
  const isTerminal = phase === "completed" || phase === "error";
  const label = labelFromProgress(progress, phase);

  return (
    <div
      aria-live="polite"
      className="ml-11 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-3 py-2 shadow-sm backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${!isTerminal ? "animate-pulse" : ""}`}
          style={{ backgroundColor: phase === "error" ? "rgb(248 113 113)" : agentColor }}
        />
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          {label}
        </span>
        {elapsed && (
          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
            {elapsed}
          </span>
        )}
        {progress?.runId && (
          <span className="hidden max-w-[10rem] truncate font-mono text-[10px] text-[var(--text-tertiary)] sm:inline">
            {progress.runId}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-6 gap-1">
        {PHASES.map((item, index) => {
          const active = item.phase === phase;
          const passed = !isTerminal && index < activeIndex;
          return (
            <div
              key={item.phase}
              title={item.label}
              className={`h-1 rounded-full transition-colors ${
                active || passed ? "bg-[var(--accent)]" : "bg-[var(--border-subtle)]"
              }`}
              style={active || passed ? { backgroundColor: agentColor } : undefined}
            />
          );
        })}
      </div>
      {progress?.activeTool?.detail && phase === "tool" && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-tertiary)]">
          {progress.activeTool.detail}
        </div>
      )}
      {phase === "error" && progress?.error && (
        <div className="mt-1 truncate text-[11px] text-red-300">{progress.error}</div>
      )}
    </div>
  );
}
