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
    detailKind?: "input" | "output" | "status";
    detailTruncated?: boolean;
  };
  checkpoint?: {
    id?: string;
    title: string;
    summary?: string;
    detail?: string;
    detailTruncated?: boolean;
  };
};

type ExecutionPhase = "run-started" | "thinking" | "tool" | "waiting" | "completed" | "error";

interface ExecutionProgressPanelProps {
  progress: ExecutionProgressEvent | null;
  events?: ExecutionProgressEvent[];
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
  if (event.includes("compact") || event.includes("checkpoint")) return "waiting";
  if (event.includes("waiting") || event.includes("heartbeat") || event.includes("reconnect") || event.includes("interrupted")) return "waiting";
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

  if (progress?.event === "connection_interrupted") return "Connection interrupted";
  if (progress?.event === "connection_recovering") return "Rehydrating session";

  return PHASES.find((item) => item.phase === phase)?.label ?? "Working";
}

function toolTitle(event: ExecutionProgressEvent) {
  const name = event.activeTool?.name ?? "tool";
  if (event.event === "tool_started") return `Tool call - ${name}`;
  if (event.event === "tool_completed") return `Tool output - ${name}`;
  return `Tool update - ${name}`;
}

function toolTone(event: ExecutionProgressEvent) {
  const status = event.activeTool?.status?.toLowerCase() ?? "";
  if (event.event === "tool_completed" && /fail|error|exit 1|exit 2/.test(status)) return "error";
  if (event.event === "tool_completed") return "done";
  if (event.event === "tool_started") return "running";
  return "neutral";
}

function toolMeta(event: ExecutionProgressEvent) {
  return [
    event.activeTool?.status,
    formatElapsed(event.elapsedMs),
    event.runId,
  ].filter(Boolean).join(" - ");
}

function detailLabel(kind: "input" | "output" | "status" | undefined) {
  if (kind === "input") return "Tool input";
  if (kind === "output") return "Tool output";
  return "Details";
}

function ToolAuditRow({ event, agentColor }: { event: ExecutionProgressEvent; agentColor: string }) {
  const tone = toolTone(event);
  const detail = event.activeTool?.detail;
  const markerColor =
    tone === "error" ? "rgb(248 113 113)" :
    tone === "done" ? "rgb(74 222 128)" :
    agentColor;

  return (
    <details className="group rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/45">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]/70">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${tone === "running" ? "animate-pulse" : ""}`}
          style={{ backgroundColor: markerColor }}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">
          {toolTitle(event)}
        </span>
        <span className="hidden max-w-[16rem] truncate font-mono text-[10px] text-[var(--text-tertiary)] sm:block">
          {toolMeta(event)}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] transition-transform group-open:rotate-90">
          &gt;
        </span>
      </summary>
      <div className="border-t border-[var(--border-subtle)] px-3 py-3">
        <dl className="grid gap-2 text-[11px] sm:grid-cols-[7rem_1fr]">
          <dt className="text-[var(--text-tertiary)]">Tool</dt>
          <dd className="font-mono text-[var(--text-secondary)]">{event.activeTool?.name ?? "tool"}</dd>
          {event.activeTool?.id && (
            <>
              <dt className="text-[var(--text-tertiary)]">Call ID</dt>
              <dd className="break-all font-mono text-[var(--text-secondary)]">{event.activeTool.id}</dd>
            </>
          )}
          {event.activeTool?.status && (
            <>
              <dt className="text-[var(--text-tertiary)]">Status</dt>
              <dd className="font-mono text-[var(--text-secondary)]">{event.activeTool.status}</dd>
            </>
          )}
          {event.at && (
            <>
              <dt className="text-[var(--text-tertiary)]">Timestamp</dt>
              <dd className="font-mono text-[var(--text-secondary)]">{event.at}</dd>
            </>
          )}
        </dl>
        {detail && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase text-[var(--text-tertiary)]">
              {detailLabel(event.activeTool?.detailKind)}
              {event.activeTool?.detailTruncated ? " - truncated" : ""}
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-[var(--border-subtle)] bg-black/20 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <code>{detail}</code>
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function CompactionAuditRow({ event, agentColor }: { event: ExecutionProgressEvent; agentColor: string }) {
  const checkpoint = event.checkpoint;
  if (!checkpoint) return null;

  return (
    <details className="group rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/45">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]/70">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: agentColor }}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">
          {checkpoint.title || "Compacted history"}
        </span>
        <span className="hidden max-w-[18rem] truncate text-[10px] text-[var(--text-tertiary)] sm:block">
          {checkpoint.summary ?? formatElapsed(event.elapsedMs) ?? "Context checkpoint"}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] transition-transform group-open:rotate-90">
          &gt;
        </span>
      </summary>
      <div className="border-t border-[var(--border-subtle)] px-3 py-3">
        <dl className="grid gap-2 text-[11px] sm:grid-cols-[7rem_1fr]">
          <dt className="text-[var(--text-tertiary)]">Event</dt>
          <dd className="font-mono text-[var(--text-secondary)]">history_compacted</dd>
          {checkpoint.id && (
            <>
              <dt className="text-[var(--text-tertiary)]">Checkpoint</dt>
              <dd className="break-all font-mono text-[var(--text-secondary)]">{checkpoint.id}</dd>
            </>
          )}
          {event.at && (
            <>
              <dt className="text-[var(--text-tertiary)]">Timestamp</dt>
              <dd className="font-mono text-[var(--text-secondary)]">{event.at}</dd>
            </>
          )}
        </dl>
        {checkpoint.detail && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase text-[var(--text-tertiary)]">
              Compaction detail{checkpoint.detailTruncated ? " - truncated" : ""}
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-[var(--border-subtle)] bg-black/20 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <code>{checkpoint.detail}</code>
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

export function ExecutionProgressPanel({
  progress,
  events = [],
  isLoading,
  hasStreamingContent,
  agentColor,
}: ExecutionProgressPanelProps) {
  const phase = phaseFromProgress(progress, isLoading, hasStreamingContent);
  if (!phase) return null;

  const elapsed = formatElapsed(progress?.elapsedMs);
  const activeIndex = PHASES.findIndex((item) => item.phase === phase);
  const isTerminal = phase === "completed" || phase === "error";
  const isCompleted = phase === "completed";
  const label = labelFromProgress(progress, phase);
  const auditEvents = events.filter((event) => event.activeTool || event.checkpoint);
  const statusDetail =
    phase === "tool" ? progress?.activeTool?.detail :
    phase === "error" ? progress?.error :
    "";
  const hasStatusDetail = Boolean(statusDetail);

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
          const passed = isCompleted ? index < activeIndex : !isTerminal && index < activeIndex;
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
      <div
        aria-hidden={!hasStatusDetail}
        className={`mt-1 min-h-[0.875rem] truncate text-[10px] leading-[0.875rem] ${
          phase === "error" ? "text-red-300" : "font-mono text-[var(--text-tertiary)]"
        }`}
      >
        {statusDetail}
      </div>
      {auditEvents.length > 0 && (
        <div
          aria-label="Tool call audit trail"
          className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1"
        >
          {auditEvents.map((event, index) => (
            event.checkpoint ? (
              <CompactionAuditRow
                key={`${event.checkpoint.id ?? event.checkpoint.title}-${event.event}-${event.at ?? index}-${index}`}
                event={event}
                agentColor={agentColor}
              />
            ) : (
              <ToolAuditRow
                key={`${event.activeTool?.id ?? event.activeTool?.name ?? "tool"}-${event.event}-${event.at ?? index}-${index}`}
                event={event}
                agentColor={agentColor}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
