"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Doc {
  id: string;
  title: string;
  content: string;
  category: string;
  docType: string;
  visibility: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  projectId: string | null;
  taskId: string | null;
  tags: string[] | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
}

const DOC_TYPES = [
  { value: "all", label: "All Types" },
  { value: "sop", label: "SOPs" },
  { value: "guide", label: "Guides" },
  { value: "reference", label: "Reference" },
  { value: "runbook", label: "Runbooks" },
  { value: "general", label: "General" },
];

const VISIBILITY_OPTIONS = [
  { value: "company", label: "Everyone" },
  { value: "project", label: "Project only" },
  { value: "agents_only", label: "Agents only" },
];

const DOC_TYPE_COLORS: Record<string, string> = {
  sop: "bg-blue-400/10 text-blue-400",
  guide: "bg-green-400/10 text-green-400",
  reference: "bg-purple-400/10 text-purple-400",
  runbook: "bg-orange-400/10 text-orange-400",
  general: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

const VISIBILITY_ICONS: Record<string, string> = {
  company: "🏢",
  project: "📁",
  agents_only: "🤖",
};

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editDocType, setEditDocType] = useState("general");
  const [editVisibility, setEditVisibility] = useState("company");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newDocType, setNewDocType] = useState("general");
  const [newVisibility, setNewVisibility] = useState("company");
  const [newProjectId, setNewProjectId] = useState("");
  const [newTags, setNewTags] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [docsRes, projectsRes] = await Promise.all([
      fetch("/api/docs").catch(() => null),
      fetch("/api/projects").catch(() => null),
    ]);

    if (docsRes?.ok) {
      const data = await docsRes.json();
      setDocs(Array.isArray(data) ? data : []);
    }
    if (projectsRes?.ok) {
      const data = await projectsRes.json();
      setProjects(Array.isArray(data) ? data : []);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = docs.filter((doc) => {
    if (typeFilter !== "all" && doc.docType !== typeFilter) return false;
    if (projectFilter !== "all" && doc.projectId !== projectFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !doc.title.toLowerCase().includes(q) &&
        !doc.content.toLowerCase().includes(q) &&
        !(doc.tags && doc.tags.some((t) => t.toLowerCase().includes(q)))
      )
        return false;
    }
    return true;
  });

  const getProjectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? null;

  function openDoc(doc: Doc) {
    setSelectedDoc(doc);
    setEditMode(false);
    setEditTitle(doc.title);
    setEditContent(doc.content);
    setEditDocType(doc.docType);
    setEditVisibility(doc.visibility);
    setEditTags(doc.tags?.join(", ") ?? "");
  }

  async function saveDoc() {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/docs/${selectedDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          docType: editDocType,
          visibility: editVisibility,
          tags: editTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
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

  async function togglePin(doc: Doc) {
    const res = await fetch(`/api/docs/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !doc.pinned }),
    });
    if (res.ok) {
      const updated = await res.json();
      setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      if (selectedDoc?.id === doc.id) setSelectedDoc(updated);
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
          content: newContent || `# ${newTitle}\n\n`,
          category: "general",
          docType: newDocType,
          visibility: newVisibility,
          projectId: newProjectId || null,
          tags: newTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (res.ok) {
        const doc = await res.json();
        setDocs((prev) => [doc, ...prev]);
        setShowCreate(false);
        setNewTitle("");
        setNewContent("");
        setNewDocType("general");
        setNewVisibility("company");
        setNewProjectId("");
        setNewTags("");
        openDoc(doc);
      }
    } finally {
      setCreating(false);
    }
  }

  const pinnedCount = docs.filter((d) => d.pinned).length;
  const typeCounts = DOC_TYPES.slice(1).reduce(
    (acc, t) => {
      acc[t.value] = docs.filter((d) => d.docType === t.value).length;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: doc list */}
      <div className="w-80 shrink-0 border-r border-border/40 flex flex-col">
        <div className="p-4 border-b border-border/40">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-bold text-lg tracking-wide">Knowledge Base</h1>
              <p className="text-[10px] text-muted-foreground tracking-wider mt-0.5">
                {docs.length} DOCS{pinnedCount > 0 && ` · ${pinnedCount} PINNED`}
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] px-3 py-1.5 rounded-lg transition-colors"
            >
              + New
            </button>
          </div>

          <input
            type="text"
            placeholder="Search docs, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-muted/40 border border-border/40 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-neo/50"
          />

          {/* Type filter tabs */}
          <div className="flex flex-wrap gap-1">
            {DOC_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTypeFilter(t.value)}
                className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                  typeFilter === t.value
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {t.label}
                {t.value !== "all" && typeCounts[t.value] > 0 && (
                  <span className="ml-1 opacity-60">{typeCounts[t.value]}</span>
                )}
              </button>
            ))}
          </div>

          {/* Project filter */}
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full bg-muted/40 border border-border/40 rounded-lg px-2 py-1.5 text-xs mt-2"
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {search || typeFilter !== "all"
                ? "No matching documents"
                : "No documents yet"}
            </div>
          ) : (
            filtered.map((doc) => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-muted/30 transition-colors ${
                  selectedDoc?.id === doc.id
                    ? "bg-[var(--accent-soft)] border-l-2 border-l-neo"
                    : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {doc.pinned && <span className="text-xs">📌</span>}
                  <span className="font-medium text-sm truncate flex-1">
                    {doc.title}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${DOC_TYPE_COLORS[doc.docType] || DOC_TYPE_COLORS.general}`}
                  >
                    {doc.docType.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px]">
                    {VISIBILITY_ICONS[doc.visibility] || "🏢"}
                  </span>
                  {doc.projectId && (
                    <span className="text-xs text-muted-foreground truncate">
                      {getProjectName(doc.projectId) || "Project"}
                    </span>
                  )}
                  {doc.tags && doc.tags.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/60 truncate">
                      {doc.tags.slice(0, 3).join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground/50 mt-0.5">
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
                    className="w-full text-xl font-bold bg-muted/40 border border-border/40 rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-neo/50"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    {selectedDoc.pinned && <span>📌</span>}
                    <h2 className="text-xl font-bold truncate">
                      {selectedDoc.title}
                    </h2>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${DOC_TYPE_COLORS[selectedDoc.docType] || DOC_TYPE_COLORS.general}`}
                  >
                    {selectedDoc.docType.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {VISIBILITY_ICONS[selectedDoc.visibility]}{" "}
                    {VISIBILITY_OPTIONS.find((v) => v.value === selectedDoc.visibility)?.label}
                  </span>
                  {selectedDoc.projectId && (
                    <span className="text-[10px] text-muted-foreground">
                      · {getProjectName(selectedDoc.projectId) || "Project"}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50">
                    · Updated {new Date(selectedDoc.updatedAt).toLocaleString()}
                  </span>
                </div>
                {selectedDoc.tags && selectedDoc.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {selectedDoc.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editMode ? (
                  <>
                    {/* Doc type and visibility selectors in edit mode */}
                    <select
                      value={editDocType}
                      onChange={(e) => setEditDocType(e.target.value)}
                      className="text-xs bg-muted/40 border border-border/40 rounded-lg px-2 py-1.5"
                    >
                      {DOC_TYPES.slice(1).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value)}
                      className="text-xs bg-muted/40 border border-border/40 rounded-lg px-2 py-1.5"
                    >
                      {VISIBILITY_OPTIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setEditMode(false)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveDoc}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => togglePin(selectedDoc)}
                      className="text-xs px-2 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40"
                      title={selectedDoc.pinned ? "Unpin" : "Pin"}
                    >
                      {selectedDoc.pinned ? "📌 Unpin" : "📌 Pin"}
                    </button>
                    <button
                      onClick={() => setEditMode(true)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40"
                    >
                      Edit
                    </button>
                    {deleteConfirm === selectedDoc.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Delete?
                        </span>
                        <button
                          onClick={() => deleteDoc(selectedDoc.id)}
                          className="text-xs px-2 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(selectedDoc.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
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
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      className="w-full bg-muted/40 border border-border/40 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neo/50"
                      placeholder="onboarding, engineering, process..."
                    />
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-96 bg-muted/20 border border-border/40 rounded-lg p-4 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-neo/50"
                    style={{ height: "calc(100vh - 340px)" }}
                    placeholder="Write markdown..."
                  />
                </div>
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
              <div className="text-5xl mb-4">📚</div>
              <h2 className="text-lg font-semibold mb-1">Knowledge Base</h2>
              <p className="text-sm text-muted-foreground mb-1">
                SOPs, guides, and reference docs for your team and agents.
              </p>
              <p className="text-xs text-muted-foreground/60 mb-4">
                Agents can access these during heartbeats for context.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-sm bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] px-4 py-2 rounded-lg transition-colors"
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
          <div className="bg-card border border-border/40 rounded-xl w-full max-w-lg p-6">
            <h3 className="font-bold text-lg mb-4">New Document</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neo/50"
                  placeholder="Document title"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Type
                  </label>
                  <select
                    value={newDocType}
                    onChange={(e) => setNewDocType(e.target.value)}
                    className="w-full bg-muted/40 border border-border/40 rounded-lg px-2 py-2 text-sm"
                  >
                    {DOC_TYPES.slice(1).map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Visibility
                  </label>
                  <select
                    value={newVisibility}
                    onChange={(e) => setNewVisibility(e.target.value)}
                    className="w-full bg-muted/40 border border-border/40 rounded-lg px-2 py-2 text-sm"
                  >
                    {VISIBILITY_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {VISIBILITY_ICONS[v.value]} {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Project (optional)
                  </label>
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full bg-muted/40 border border-border/40 rounded-lg px-2 py-2 text-sm"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Tags
                  </label>
                  <input
                    type="text"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    className="w-full bg-muted/40 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neo/50"
                    placeholder="tag1, tag2..."
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Content (markdown)
                </label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded-lg px-3 py-2 text-sm font-mono h-40 resize-none focus:outline-none focus:ring-1 focus:ring-neo/50"
                  placeholder="Write your document content..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewTitle("");
                  setNewContent("");
                  setNewDocType("general");
                  setNewVisibility("company");
                  setNewProjectId("");
                  setNewTags("");
                }}
                className="text-sm px-4 py-2 rounded-lg border border-border/40 hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={createDoc}
                disabled={creating || !newTitle.trim()}
                className="text-sm px-4 py-2 rounded-lg bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
