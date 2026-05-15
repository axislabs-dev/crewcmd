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

type ExecutionPhase = "run-started" | "thinking" | "tool" | "compaction" | "waiting" | "completed" | "error";

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
  { phase: "compaction", label: "Compacting" },
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
  if (event.includes("compact") || event.includes("checkpoint")) return "compaction";
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

  if (phase === "compaction") {
    return progress?.checkpoint?.title || "Compacting context";
  }

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
  const summary = summarizeToolEvent(event);
  if (summary.title) return summary.title;
  if (event.event === "tool_started") return `Calling ${name}`;
  if (event.event === "tool_completed") return `Completed ${name}`;
  return `Updated ${name}`;
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

function parseToolDetail(detail: string | undefined): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

function asToolRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function compactValue(value: unknown, maxLength = 96): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function looksLikeJson(text: string) {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function compactHumanValue(value: unknown, maxLength = 96): string | null {
  const text = compactValue(value, maxLength);
  if (!text || looksLikeJson(text)) return null;
  return text;
}

function findFirstStringByKey(value: unknown, keys: string[], seen = new Set<unknown>()): string | null {
  if (value === undefined || value === null || seen.has(value)) return null;
  if (typeof value !== "object") return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKey(item, keys, seen);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number" || typeof direct === "boolean") return String(direct);
  }
  for (const item of Object.values(record)) {
    const found = findFirstStringByKey(item, keys, seen);
    if (found) return found;
  }
  return null;
}

function fileLabel(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `.../${parts.slice(-3).join("/")}`;
}

function summarizeToolEvent(event: ExecutionProgressEvent) {
  const name = event.activeTool?.name ?? "tool";
  const normalizedName = name.toLowerCase();
  const detail = parseToolDetail(event.activeTool?.detail);
  const detailRecord = asToolRecord(detail);
  const isOutput = event.event === "tool_completed" || event.activeTool?.detailKind === "output";
  const command = isOutput ? null : findFirstStringByKey(detail, ["cmd", "command", "shellCommand", "shell_command"]);
  const file = findFirstStringByKey(detail, [
    "file",
    "filepath",
    "filePath",
    "filename",
    "path",
    "target_file",
    "targetFile",
    "cwd",
  ]);
  const query = isOutput ? null : findFirstStringByKey(detail, ["query", "q", "pattern", "search", "term", "text"]);
  const detailSummary = compactHumanValue(detailRecord?.summary ?? detailRecord?.message ?? detailRecord?.title ?? detail, 120);

  if (normalizedName.includes("exec") || command) {
    return {
      title: `${isOutput ? "Exec finished" : "Exec"}${command ? `: ${compactValue(command, 120)}` : ""}`,
      meta: file ? `in ${fileLabel(file)}` : null,
    };
  }

  if (normalizedName.includes("read")) {
    return {
      title: `${isOutput ? "Read finished" : "Read"}${file ? `: ${fileLabel(file)}` : ""}`,
      meta: query && query !== file ? compactValue(query) : null,
    };
  }

  if (normalizedName.includes("edit") || normalizedName.includes("patch") || normalizedName.includes("write")) {
    return {
      title: `${isOutput ? "Edit finished" : "Edit"}${file ? `: ${fileLabel(file)}` : ""}`,
      meta: command ? compactValue(command, 120) : null,
    };
  }

  if (normalizedName.includes("search") || query) {
    return {
      title: `${isOutput ? "Search finished" : "Search"}${query ? `: ${compactValue(query, 120)}` : ""}`,
      meta: file ? `in ${fileLabel(file)}` : null,
    };
  }

  return {
    title: `${isOutput ? "Completed" : "Calling"} ${name}`,
    meta: detailSummary,
  };
}

function toolStatusDetail(event: ExecutionProgressEvent | null) {
  if (!event?.activeTool) return "";
  const summary = summarizeToolEvent(event);
  return [summary.title, summary.meta].filter(Boolean).join(" - ");
}

function activityLabel(event: ExecutionProgressEvent) {
  if (event.checkpoint) return event.checkpoint.title || "Checkpoint";
  if (event.activeTool) return summarizeToolEvent(event).title;
  return event.event.replace(/_/g, " ");
}

function activityTone(event: ExecutionProgressEvent) {
  if (event.checkpoint) return "checkpoint";
  return toolTone(event);
}

function activityCountLabel(count: number) {
  if (count === 0) return "No tool events";
  if (count === 1) return "1 tool event";
  return `${count} tool events`;
}

function idleStatusText(phase: ExecutionPhase, hasStreamingContent: boolean) {
  if (phase === "completed") return "Response complete";
  if (phase === "error") return "Run stopped";
  if (phase === "compaction") return "Compacting conversation history";
  if (phase === "waiting") return "Waiting for the next event";
  if (hasStreamingContent) return "Drafting response";
  return "Starting run";
}

function ToolAuditRow({ event, agentColor }: { event: ExecutionProgressEvent; agentColor: string }) {
  const tone = toolTone(event);
  const detail = event.activeTool?.detail;
  const summary = summarizeToolEvent(event);
  const markerColor =
    tone === "error" ? "rgb(248 113 113)" :
    tone === "done" ? "rgb(74 222 128)" :
    agentColor;

  return (
    <details className="group border-t border-[var(--border-subtle)] first:border-t-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]/45">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-[var(--bg-surface)] ${tone === "running" ? "animate-pulse" : ""}`}
          style={{ backgroundColor: markerColor }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
            {toolTitle(event)}
          </span>
          {summary.meta && (
            <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
              {summary.meta}
            </span>
          )}
        </span>
        <span className="hidden max-w-[16rem] truncate font-mono text-[10px] text-[var(--text-tertiary)] sm:block">
          {toolMeta(event)}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] transition-transform group-open:rotate-90">
          &gt;
        </span>
      </summary>
      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/25 px-3 py-3">
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
    <details className="group border-t border-[var(--border-subtle)] first:border-t-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]/45">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-[var(--bg-surface)]"
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
      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/25 px-3 py-3">
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
  const auditEvents = events.filter((event) => event.activeTool || event.checkpoint);
  const phase = phaseFromProgress(progress, isLoading, hasStreamingContent) ?? (auditEvents.length > 0 ? "completed" : null);
  if (!phase) return null;

  const elapsed = formatElapsed(progress?.elapsedMs);
  const isTerminal = phase === "completed" || phase === "error";
  const label = progress ? labelFromProgress(progress, phase) : "Tool activity";
  const statusDetail =
    phase === "tool" ? toolStatusDetail(progress) :
    phase === "compaction" ? progress?.checkpoint?.summary ?? progress?.checkpoint?.detail ?? "Preserving context before continuing" :
    phase === "error" ? progress?.error :
    "";
  const hasStatusDetail = Boolean(statusDetail);
  const visibleActivity = auditEvents.slice(-4);
  const latestActivity = auditEvents[auditEvents.length - 1] ?? null;
  const currentStatus = latestActivity ? activityLabel(latestActivity) : idleStatusText(phase, hasStreamingContent);
  const currentTone = latestActivity ? activityTone(latestActivity) : "neutral";
  const currentMarkerColor =
    phase === "error" || currentTone === "error" ? "rgb(248 113 113)" :
    currentTone === "done" || phase === "completed" ? "rgb(74 222 128)" :
    agentColor;

  return (
    <div
      aria-live="polite"
      className="ml-11 max-w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 p-3 shadow-sm backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ring-4 ring-[var(--bg-elevated)] ${!isTerminal ? "animate-pulse" : ""}`}
            style={{ backgroundColor: phase === "error" ? "rgb(248 113 113)" : agentColor }}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {label}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden text-[10px] font-medium text-[var(--text-tertiary)] sm:inline">
            {activityCountLabel(auditEvents.length)}
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
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30">
        <div className="grid min-h-12 grid-cols-[0.35rem_1fr_auto] items-stretch">
          <div
            className="opacity-80"
            style={{ backgroundColor: currentMarkerColor }}
          />
          <div className="min-w-0 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: currentMarkerColor }} />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Current operation
              </span>
            </div>
            <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
              {currentStatus}
            </div>
          </div>
          <div className="flex items-center gap-1.5 border-l border-[var(--border-subtle)] px-2">
            {visibleActivity.length > 0 ? (
              visibleActivity.map((event, index) => {
                const tone = activityTone(event);
                const markerColor =
                  tone === "error" ? "rgb(248 113 113)" :
                  tone === "done" ? "rgb(74 222 128)" :
                  agentColor;
                const label = activityLabel(event);
                return (
                  <span
                    key={`${event.activeTool?.id ?? event.checkpoint?.id ?? event.event}-${event.at ?? index}-${index}`}
                    className={`h-2 w-2 rounded-full ${tone === "running" ? "animate-pulse" : ""}`}
                    style={{ backgroundColor: markerColor }}
                    title={label}
                  />
                );
              })
            ) : (
              <span className="h-2 w-7 rounded-full bg-[var(--border-subtle)]" />
            )}
            {auditEvents.length > visibleActivity.length && (
              <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                +{auditEvents.length - visibleActivity.length}
              </span>
            )}
            {!isTerminal && (
              <span className="ml-1 flex h-4 items-center gap-0.5" aria-hidden="true">
                <span className="h-1.5 w-0.5 animate-pulse rounded-full" style={{ backgroundColor: agentColor }} />
                <span className="h-3 w-0.5 animate-pulse rounded-full [animation-delay:120ms]" style={{ backgroundColor: agentColor }} />
                <span className="h-2 w-0.5 animate-pulse rounded-full [animation-delay:240ms]" style={{ backgroundColor: agentColor }} />
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="sr-only">Current execution phase: {label}</div>
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
          className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/45"
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
