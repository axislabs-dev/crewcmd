"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ProjectDoc {
  name: string;
  url: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: "active" | "completed" | "archived";
  ownerAgentId: string | null;
  documents: ProjectDoc[] | null;
  context: string | null;
  contextUpdatedAt: string | null;
  contextUpdatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string | null;
  assignedAgentId: string | null;
}

const statusColors: Record<string, string> = {
  active: "text-green-400 bg-green-400/10 border-green-400/20",
  completed: "text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent-medium)]",
  archived: "text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)] border-[var(--border-medium)]",
};

const taskStatusColors: Record<string, string> = {
  inbox: "#666",
  queued: "#00f0ff",
  in_progress: "#f0ff00",
  review: "#ff00aa",
  done: "#00ff88",
};

const priorityStyles: Record<string, string> = {
  low: "text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)]",
  medium: "text-blue-400 bg-blue-400/10",
  high: "text-orange-400 bg-orange-400/10",
  critical: "text-red-400 bg-red-400/10",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", description: "", color: "#00f0ff", status: "active" });
  const [creating, setCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", color: "#00f0ff", status: "active" });
  const [editDocs, setEditDocs] = useState<ProjectDoc[]>([]);
  const [editContext, setEditContext] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()).catch(() => []),
      fetch("/api/tasks").then((r) => r.json()).catch(() => []),
    ]).then(([p, t]) => {
      setProjects(p);
      setTasks(t);
      setLoading(false);
    });
  }, []);

  const getTaskCount = (projectId: string) =>
    tasks.filter((t) => t.projectId === projectId).length;

  const getCompletedCount = (projectId: string) =>
    tasks.filter((t) => t.projectId === projectId && t.status === "done").length;

  const getProgress = (projectId: string) => {
    const total = getTaskCount(projectId);
    if (total === 0) return 0;
    return Math.round((getCompletedCount(projectId) / total) * 100);
  };

  function openProjectDetail(project: Project) {
    setSelectedProject(project);
    setEditForm({
      name: project.name,
      description: project.description || "",
      color: project.color || "#00f0ff",
      status: project.status,
    });
    setEditDocs(project.documents ? [...project.documents] : []);
    setEditContext(project.context || "");
    setEditing(false);
  }

  async function saveProject() {
    if (!selectedProject) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          color: editForm.color,
          status: editForm.status,
          documents: editDocs.filter((d) => d.name.trim() && d.url.trim()),
          context: editContext || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setSelectedProject(updated);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject() {
    if (!selectedProject || !confirm("Delete this project? Tasks will be unlinked.")) return;
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, { method: "DELETE" });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== selectedProject.id));
        setSelectedProject(null);
      }
    } catch { /* empty */ }
  }

  const projectTasks = selectedProject
    ? tasks.filter((t) => t.projectId === selectedProject.id)
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
              PROJECTS
            </h1>
            <p className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
              {projects.filter((p) => p.status === "active").length} ACTIVE
              &middot; {projects.length} TOTAL
            </p>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-soft)] hover:shadow-[0_0_15px_rgba(0,240,255,0.15)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            NEW PROJECT
          </button>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="glass-card w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-sm font-bold tracking-[0.15em] text-[var(--text-primary)]">NEW PROJECT</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">NAME</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="Project name..."
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-neo/30"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
                  <textarea
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    placeholder="What is this project about..."
                    rows={3}
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-neo/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">COLOR</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newProject.color}
                      onChange={(e) => setNewProject({ ...newProject, color: e.target.value })}
                      className="h-8 w-8 rounded border border-[var(--border-medium)] bg-[var(--bg-surface)] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={newProject.color}
                      onChange={(e) => setNewProject({ ...newProject, color: e.target.value })}
                      className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-neo/30"
                      placeholder="#00f0ff"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
                  <select
                    value={newProject.status}
                    onChange={(e) => setNewProject({ ...newProject, status: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  CANCEL
                </button>
                <button
                  onClick={async () => {
                    if (!newProject.name.trim()) return;
                    setCreating(true);
                    try {
                      const res = await fetch("/api/projects", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(newProject),
                      });
                      if (res.ok) {
                        const created = await res.json();
                        setProjects([...projects, created]);
                        setNewProject({ name: "", description: "", color: "#00f0ff", status: "active" });
                        setShowCreate(false);
                      }
                    } finally {
                      setCreating(false);
                    }
                  }}
                  disabled={creating || !newProject.name.trim()}
                  className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-medium)] disabled:opacity-30"
                >
                  {creating ? "CREATING..." : "CREATE PROJECT"}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedProject(null)}>
            <div className="glass-card w-full max-w-2xl space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider ${statusColors[selectedProject.status]}`}
                  >
                    {selectedProject.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!editing && (
                    <button
                      onClick={() => setEditing(true)}
                      className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
                    >
                      EDIT
                    </button>
                  )}
                  <button
                    onClick={deleteProject}
                    className="rounded-lg border border-red-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-red-400/40 transition-colors hover:text-red-400"
                  >
                    DELETE
                  </button>
                  <button
                    onClick={() => setSelectedProject(null)}
                    className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">NAME</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">COLOR</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editForm.color}
                        onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                        className="h-8 w-8 rounded border border-[var(--border-medium)] bg-[var(--bg-surface)] cursor-pointer"
                      />
                      <input
                        type="text"
                        value={editForm.color}
                        onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                        className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-neo/30"
                        placeholder="#00f0ff"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">CONTEXT / BACKGROUND</label>
                    <p className="mb-2 font-mono text-[9px] text-[var(--text-tertiary)]">Background, constraints, client info — agents read this before picking up tasks. Markdown supported.</p>
                    <textarea
                      value={editContext}
                      onChange={(e) => setEditContext(e.target.value)}
                      rows={6}
                      placeholder="Project background, client details, constraints, goals, stack info, anything agents should know..."
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-neo/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DOCUMENTS / REFERENCES</label>
                    <div className="space-y-2">
                      {editDocs.map((doc, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={doc.name}
                            onChange={(e) => {
                              const next = [...editDocs];
                              next[i] = { ...next[i], name: e.target.value };
                              setEditDocs(next);
                            }}
                            placeholder="Name..."
                            className="w-1/3 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-neo/30"
                          />
                          <input
                            type="text"
                            value={doc.url}
                            onChange={(e) => {
                              const next = [...editDocs];
                              next[i] = { ...next[i], url: e.target.value };
                              setEditDocs(next);
                            }}
                            placeholder="URL or file path..."
                            className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-neo/30"
                          />
                          <button
                            onClick={() => setEditDocs(editDocs.filter((_, j) => j !== i))}
                            className="text-[var(--text-tertiary)] transition-colors hover:text-red-400"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setEditDocs([...editDocs, { name: "", url: "" }])}
                        className="font-mono text-[10px] tracking-wider text-[var(--accent)]/60 transition-colors hover:text-[var(--accent)]"
                      >
                        + ADD DOCUMENT
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={saveProject}
                      disabled={saving}
                      className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-medium)] disabled:opacity-30"
                    >
                      {saving ? "SAVING..." : "SAVE CHANGES"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    {selectedProject.name.toUpperCase()}
                  </h2>
                  {selectedProject.description && (
                    <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      {selectedProject.description}
                    </p>
                  )}

                  {selectedProject.context && (
                    <div className="rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg className="h-3.5 w-3.5 text-[var(--accent)]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                          </svg>
                          <span className="font-mono text-[10px] tracking-[0.15em] text-[var(--accent)]/60">
                            CONTEXT / BACKGROUND
                          </span>
                        </div>
                        {selectedProject.contextUpdatedAt && (
                          <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                            {selectedProject.contextUpdatedBy && `${selectedProject.contextUpdatedBy} · `}
                            {new Date(selectedProject.contextUpdatedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="prose-invert max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-[var(--text-secondary)] [&_a]:text-[var(--accent)]/70 [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--bg-surface-hover)] [&_code]:px-1 [&_code]:text-[var(--accent)]/60 [&_h1]:mb-2 [&_h1]:text-xs [&_h1]:font-bold [&_h1]:text-[var(--text-secondary)] [&_h2]:mb-2 [&_h2]:text-[11px] [&_h2]:font-bold [&_h2]:text-[var(--text-secondary)] [&_h3]:mb-1 [&_h3]:text-[11px] [&_h3]:font-bold [&_h3]:text-[var(--text-secondary)] [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:mb-2 [&_pre]:rounded [&_pre]:bg-[var(--bg-surface-hover)] [&_pre]:p-2 [&_ul]:list-disc">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedProject.context}</ReactMarkdown>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4 border-t border-[var(--border-subtle)] pt-4">
                    <div>
                      <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">PROGRESS</span>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-surface-hover)]">
                          <div
                            className="h-full rounded-full bg-neo/50 transition-all duration-500"
                            style={{
                              width: `${getProgress(selectedProject.id)}%`,
                              boxShadow: getProgress(selectedProject.id) > 0 ? "0 0 8px rgba(0, 240, 255, 0.3)" : "none",
                            }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-[var(--accent)]/60">
                          {getProgress(selectedProject.id)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">TASKS</span>
                      <div className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">
                        {getCompletedCount(selectedProject.id)}/{getTaskCount(selectedProject.id)} completed
                      </div>
                    </div>
                    <div>
                      <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">CREATED</span>
                      <div className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">
                        {new Date(selectedProject.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div>
                      <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">UPDATED</span>
                      <div className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">
                        {new Date(selectedProject.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {selectedProject.documents && selectedProject.documents.length > 0 && (
                    <div className="border-t border-[var(--accent-medium)] pt-4">
                      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-3 py-2">
                        <svg className="h-4 w-4 shrink-0 text-[var(--accent)]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                        </svg>
                        <span className="font-mono text-[10px] tracking-wider text-[var(--accent)]/70">
                          READ BEFORE PICKING UP TASKS
                        </span>
                      </div>
                      <h3 className="mb-3 font-mono text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">
                        REFERENCES ({selectedProject.documents.length})
                      </h3>
                      <div className="space-y-2">
                        {selectedProject.documents.map((doc, i) => (
                          <a
                            key={i}
                            href={doc.url.startsWith("http") ? doc.url : `/docs?file=${encodeURIComponent(doc.url)}`}
                            target={doc.url.startsWith("http") ? "_blank" : undefined}
                            rel={doc.url.startsWith("http") ? "noopener noreferrer" : undefined}
                            className="flex items-center gap-2 rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-3 py-2 transition-colors hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]"
                          >
                            <svg className="h-4 w-4 shrink-0 text-[var(--accent)]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">{doc.name}</span>
                            <span className="shrink-0 font-mono text-[9px] text-[var(--accent)]/40">{doc.url.startsWith("http") ? "↗ LINK" : "→ FILE"}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-[var(--border-subtle)] pt-4">
                    <h3 className="mb-3 font-mono text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">
                      PROJECT TASKS ({projectTasks.length})
                    </h3>
                    {projectTasks.length > 0 ? (
                      <div className="max-h-48 space-y-2 overflow-y-auto">
                        {projectTasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                          >
                            <div
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: taskStatusColors[task.status] || "#666" }}
                            />
                            <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                              {task.title}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${priorityStyles[task.priority] || ""}`}
                            >
                              {task.priority}
                            </span>
                            <span className="shrink-0 font-mono text-[9px] text-[var(--text-tertiary)]">
                              {task.status.replace("_", " ").toUpperCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-[var(--text-tertiary)]">
                        No tasks assigned to this project
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
          </div>
        ) : projects.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-16">
            <svg className="mb-4 h-12 w-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            <p className="text-sm text-[var(--text-tertiary)]">No projects yet</p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Projects will appear here as agents create them
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const progress = getProgress(project.id);
              const taskCount = getTaskCount(project.id);
              const completedCount = getCompletedCount(project.id);

              return (
                <div
                  key={project.id}
                  onClick={() => openProjectDetail(project)}
                  className="glass-card glass-card-hover cursor-pointer space-y-4 p-5 transition-all duration-200"
                >
                  <div 
                    className="h-1 -mx-5 -mt-5 mb-4 rounded-t-lg"
                    style={{ backgroundColor: project.color || "#00f0ff" }}
                  />
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                      {project.name.toUpperCase()}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider ${statusColors[project.status]}`}
                    >
                      {project.status.toUpperCase()}
                    </span>
                  </div>

                  {project.description && (
                    <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      {project.description}
                    </p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {completedCount}/{taskCount} TASKS
                      </span>
                      <span className="font-mono text-[10px]" style={{ color: project.color || "#00f0ff" }}>
                        {progress}%
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-surface-hover)]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progress}%`,
                          backgroundColor: project.color || "#00f0ff",
                          boxShadow: progress > 0 ? `0 0 8px ${project.color || "#00f0ff"}50` : "none",
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                      {project.documents && project.documents.length > 0 && (
                        <span className="rounded border border-[var(--accent-medium)] px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-[var(--accent)]/50">
                          {project.documents.length} REF{project.documents.length !== 1 ? "S" : ""}
                        </span>
                      )}
                      {project.context && (
                        <span className="rounded border border-amber-400/20 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-amber-400/50">
                          CTX
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[9px] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent)]">
                      VIEW DETAILS →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
