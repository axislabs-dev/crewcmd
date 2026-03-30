"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Doc {
  id: string;
  title: string;
  content: string;
  category: string;
  authorAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
}

interface Task {
  id: string;
  title: string;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [docsRes, projectsRes, tasksRes] = await Promise.all([
      fetch("/api/docs").catch(() => null),
      fetch("/api/projects").catch(() => null),
      fetch("/api/tasks").catch(() => null),
    ]);

    if (docsRes?.ok) {
      const data = await docsRes.json();
      setDocs(Array.isArray(data) ? data : []);
    }
    if (projectsRes?.ok) {
      const data = await projectsRes.json();
      setProjects(Array.isArray(data) ? data : []);
    }
    if (tasksRes?.ok) {
      const data = await tasksRes.json();
      setTasks(Array.isArray(data) ? data : []);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = docs.filter((doc) => {
    if (projectFilter !== "all" && doc.projectId !== projectFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!doc.title.toLowerCase().includes(q) && !doc.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const getProjectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "No project";

  const getTaskTitle = (id: string | null) =>
    tasks.find((t) => t.id === id)?.title ?? null;

  function openDoc(doc: Doc) {
    setSelectedDoc(doc);
    setEditMode(false);
    setEditTitle(doc.title);
    setEditContent(doc.content);
  }

  async function saveDoc() {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/docs/${selectedDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedDoc(updated);
        setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc(id: string) {
    await fetch(`/api/docs/${id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (selectedDoc?.id === id) setSelectedDoc(null);
    setDeleteConfirm(null);
  }

  async function createDoc() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          content: newContent || "# " + newTitle + "\n\n",
          category: "general",
          projectId: newProjectId || null,
        }),
      });
      if (res.ok) {
        const doc = await res.json();
        setDocs((prev) => [doc, ...prev]);
        setShowCreate(false);
        setNewTitle("");
        setNewContent("");
        setNewProjectId("");
        openDoc(doc);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: doc list */}
      <div className="w-80 shrink-0 border-r border-border/40 flex flex-col">
        <div className="p-4 border-b border-border/40">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-bold text-lg">Documents</h1>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs bg-neo/20 hover:bg-neo/30 text-neo px-2 py-1 rounded"
            >
              + New
            </button>
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-muted/40 border border-border/40 rounded px-3 py-1.5 text-sm mb-2"
          />
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="w-full bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-sm"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No documents found</div>
          ) : (
            filtered.map((doc) => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-muted/30 transition-colors ${
                  selectedDoc?.id === doc.id ? "bg-neo/10 border-l-2 border-l-neo" : ""
                }`}
              >
                <div className="font-medium text-sm truncate">{doc.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {getProjectName(doc.projectId)}
                  {doc.taskId && ` · ${getTaskTitle(doc.taskId) ?? "Task"}`}
                </div>
                <div className="text-xs text-muted-foreground/60 mt-0.5">
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main: doc viewer/editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedDoc ? (
          <>
            <div className="p-4 border-b border-border/40 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                {editMode ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full text-xl font-bold bg-muted/40 border border-border/40 rounded px-3 py-1"
                  />
                ) : (
                  <h2 className="text-xl font-bold truncate">{selectedDoc.title}</h2>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {getProjectName(selectedDoc.projectId)}
                  {selectedDoc.taskId && ` · ${getTaskTitle(selectedDoc.taskId) ?? "Task"}`}
                  {" · "}Updated {new Date(selectedDoc.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editMode ? (
                  <>
                    <button
                      onClick={() => setEditMode(false)}
                      className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-muted/40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveDoc}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded bg-neo/20 hover:bg-neo/30 text-neo disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditMode(true)}
                      className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-muted/40"
                    >
                      Edit
                    </button>
                    {deleteConfirm === selectedDoc.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">Delete?</span>
                        <button
                          onClick={() => deleteDoc(selectedDoc.id)}
                          className="text-xs px-2 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1.5 rounded border border-border/40 hover:bg-muted/40"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(selectedDoc.id)}
                        className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-96 bg-muted/20 border border-border/40 rounded p-4 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-neo/50"
                  placeholder="Write markdown..."
                />
              ) : (
                <div className="prose prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedDoc.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="text-4xl mb-3">📄</div>
              <p className="text-sm">Select a document to view</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 text-sm bg-neo/20 hover:bg-neo/30 text-neo px-4 py-2 rounded"
              >
                Create your first document
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create doc modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border/40 rounded-lg w-full max-w-lg p-6">
            <h3 className="font-bold text-lg mb-4">New Document</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm"
                  placeholder="Document title"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Project (optional)</label>
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded px-2 py-2 text-sm"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Initial content (markdown)</label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm font-mono h-32 resize-none"
                  placeholder="Optional initial content..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowCreate(false); setNewTitle(""); setNewContent(""); setNewProjectId(""); }}
                className="text-sm px-4 py-2 rounded border border-border/40 hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={createDoc}
                disabled={creating || !newTitle.trim()}
                className="text-sm px-4 py-2 rounded bg-neo/20 hover:bg-neo/30 text-neo disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
