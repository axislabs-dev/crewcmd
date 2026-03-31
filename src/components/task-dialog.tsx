"use client";

import { useState, useEffect } from "react";
import type { Agent, Project, Task } from "@/lib/data";

interface TaskDialogProps {
  agent: Agent;
  onClose: () => void;
}

interface TaskResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Modal dialog for sending a task/prompt to a running agent.
 * Shows agent info, prompt input, and result panel after submission.
 */
export function TaskDialog({ agent, onClose }: TaskDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [relatedTaskId, setRelatedTaskId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.ok ? r.json() : []),
      fetch("/api/tasks").then((r) => r.ok ? r.json() : []),
    ]).then(([projData, taskData]) => {
      setProjects(Array.isArray(projData) ? projData : projData.projects || []);
      setTasks(Array.isArray(taskData) ? taskData : []);
    }).catch(() => {});
  }, []);

  async function handleSubmit() {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/agents/${agent.callsign.toLowerCase()}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          projectId: projectId || undefined,
          relatedTaskId: relatedTaskId || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult({
          success: true,
          output: data.output || data.message || "Task sent successfully",
        });
      } else {
        setResult({
          success: false,
          output: "",
          error: data.error || "Failed to send task",
        });
      }
    } catch {
      setError("Failed to send task to agent");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnother() {
    setPrompt("");
    setTitle("");
    setResult(null);
    setError(null);
  }

  const statusColors: Record<string, string> = {
    online: "bg-green-500",
    working: "bg-yellow-500",
    idle: "bg-amber-500",
    offline: "bg-[#555]",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{agent.emoji}</span>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  className="font-mono text-sm font-bold tracking-wider"
                  style={{ color: agent.color }}
                >
                  {agent.callsign.toUpperCase()}
                </h2>
                <span className={`inline-block h-2 w-2 rounded-full ${statusColors[agent.status] || "bg-[#555]"}`} />
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]">{agent.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-lg text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {!result ? (
            <>
              {/* Prompt */}
              <div>
                <label className="mb-1.5 block text-[11px] tracking-wider text-[var(--text-tertiary)] uppercase">
                  Task Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want this agent to do..."
                  rows={6}
                  className="w-full resize-y rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--accent)]"
                />
              </div>

              {/* Optional fields toggle */}
              <button
                onClick={() => setShowOptional(!showOptional)}
                className="text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
              >
                {showOptional ? "- HIDE OPTIONS" : "+ MORE OPTIONS"}
              </button>

              {showOptional && (
                <div className="space-y-3">
                  {/* Title */}
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-wider text-[var(--text-tertiary)] uppercase">
                      Title (optional)
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Short title for this task"
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                  </div>

                  {/* Project select */}
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-wider text-[var(--text-tertiary)] uppercase">
                      Related Project (optional)
                    </label>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                    >
                      <option value="">None</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Related task select */}
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-wider text-[var(--text-tertiary)] uppercase">
                      Related Task (optional)
                    </label>
                    <select
                      value={relatedTaskId}
                      onChange={(e) => setRelatedTaskId(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                    >
                      <option value="">None</option>
                      {tasks.slice(0, 50).map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.shortId} — {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Result panel */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wider ${
                    result.success
                      ? "bg-green-500/15 text-green-500"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {result.success ? "SUCCESS" : "ERROR"}
                </span>
              </div>

              {/* Output in terminal style */}
              <div className="max-h-[300px] overflow-y-auto rounded-lg bg-[#0d1117] p-3 font-mono text-[12px] leading-relaxed">
                {result.error ? (
                  <span className="text-[#f97583]">{result.error}</span>
                ) : (
                  <span className="text-[#c9d1d9] whitespace-pre-wrap">{result.output}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
          {!result ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                CANCEL
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !prompt.trim()}
                className="flex-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-35"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    SENDING...
                  </span>
                ) : (
                  "SEND TASK"
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                CLOSE
              </button>
              <button
                onClick={handleAnother}
                className="flex-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
              >
                ASSIGN ANOTHER
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
