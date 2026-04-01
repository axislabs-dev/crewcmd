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
  { value: "reference", label: "References" },
  { value: "runbook", label: "Runbooks" },
  { value: "general", label: "General" },
];

const VISIBILITY_OPTIONS = [
  { value: "company", label: "Everyone" },
  { value: "project", label: "Project only" },
  { value: "agents_only", label: "Agents only" },
];

const TYPE_COLORS: Record<string, string> = {
  sop: "bg-blue-500/20 text-blue-400",
  guide: "bg-green-500/20 text-green-400",
  reference: "bg-purple-500/20 text-purple-400",
  runbook: "bg-orange-500/20 text-orange-400",
  general: "bg-[var(--accent-soft)] text-[var(--accent)]",
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
  const [editProjectId, setEditProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newDocType, setNewDocType] = useState("general");
  const [newVisibility, setNewVisibility] = useState("company");
  const [newTags, setNewTags] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
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

  const pinnedDocs = filtered.filter((d) => d.pinned);
  const unpinnedDocs = filtered.filter((d) => !d.pinned);

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
    setEditProjectId(doc.projectId ?? "");
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
          projectId: editProjectId || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedDoc(updated);
        setDocs((prev) =>
          prev.map((d) => (d.id === updated.id ? updated : d))
        );
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
      if (selectedDoc?.id === updated.id) setSelectedDoc(updated);
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
          tags: newTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          projectId: newProjectId || null,
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
        setNewTags("");
        setNewProjectId("");
        openDoc(doc);
      }
    } finally {
      setCreating(false);
    }
  }

  function DocListItem({ doc }: { doc: Doc }) {
    return (
      <button
        onClick={() => openDoc(doc)}
        className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-muted/30 transition-colors ${
          selectedDoc?.id === doc.id
            ? "bg-[var(--accent-soft)] border-l-2 border-l-neo"
            : ""
        }`}
      >
        <div className="flex items-center gap-2">
          {doc.pinned && (
            <svg
              className="h-3 w-3 shrink-0 text-yellow-400"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
            </svg>
          )}
          <div className="font-medium text-sm truncate flex-1">
            {doc.title}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${TYPE_COLORS[doc.docType] ?? TYPE_COLORS.general}`}
          >
            {doc.docType}
          </span>
          {doc.visibility === "agents_only" && (
            <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
              Agents
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          {getProjectName(doc.projectId) && (
            <>
              <span>{getProjectName(doc.projectId)}</span>
              <span>·</span>
            </>
          )}
          <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
        </div>
        {doc.tags && doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {doc.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-block rounded bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {doc.tags.length > 3 && (
              <span className="text-[9px] text-muted-foreground">
                +{doc.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: doc list */}
      <div className="w-80 shrink-0 border-r border-border/40 flex flex-col">
        <div className="p-4 border-b border-border/40">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-bold text-lg">Knowledge Base</h1>
              <p className="text-[10px] text-muted-foreground tracking-wider">
                SOPS · GUIDES · REFERENCES
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] px-2 py-1 rounded"
            >
              + New
            </button>
          </div>
          <input
            type="text"
            placeholder="Search docs, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-muted/40 border border-border/40 rounded px-3 py-1.5 text-sm mb-2"
          />
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="flex-1 bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="flex-1 bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No documents found
            </div>
          ) : (
            <>
              {pinnedDocs.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-[9px] font-semibold tracking-widest uppercase text-muted-foreground">
                    Pinned
                  </div>
                  {pinnedDocs.map((doc) => (
                    <DocListItem key={doc.id} doc={doc} />
                  ))}
                </div>
              )}
              {unpinnedDocs.length > 0 && (
                <div>
                  {pinnedDocs.length > 0 && (
                    <div className="px-4 pt-3 pb-1 text-[9px] font-semibold tracking-widest uppercase text-muted-foreground">
                      All Documents
                    </div>
                  )}
                  {unpinnedDocs.map((doc) => (
                    <DocListItem key={doc.id} doc={doc} />
                  ))}
                </div>
              )}
            </>
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
                  <h2 className="text-xl font-bold truncate">
                    {selectedDoc.title}
                  </h2>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${TYPE_COLORS[selectedDoc.docType] ?? TYPE_COLORS.general}`}
                  >
                    {selectedDoc.docType}
                  </span>
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {VISIBILITY_OPTIONS.find(
                      (v) => v.value === selectedDoc.visibility
                    )?.label ?? selectedDoc.visibility}
                  </span>
                  {getProjectName(selectedDoc.projectId) && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {getProjectName(selectedDoc.projectId)}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground">
                    Updated {new Date(selectedDoc.updatedAt).toLocaleString()}
                  </span>
                </div>
                {selectedDoc.tags && selectedDoc.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {selectedDoc.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
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
                    <button
                      onClick={() => setEditMode(false)}
                      className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-muted/40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveDoc}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => togglePin(selectedDoc)}
                      className={`text-xs px-2 py-1.5 rounded border border-border/40 hover:bg-muted/40 ${selectedDoc.pinned ? "text-yellow-400" : "text-muted-foreground"}`}
                      title={selectedDoc.pinned ? "Unpin" : "Pin"}
                    >
                      <svg
                        className="h-4 w-4"
                        fill={selectedDoc.pinned ? "currentColor" : "none"}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setEditMode(true)}
                      className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-muted/40"
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

            {/* Edit metadata panel */}
            {editMode && (
              <div className="px-4 py-3 border-b border-border/40 bg-muted/10">
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-[9px] text-muted-foreground block mb-1 uppercase tracking-wider">
                      Type
                    </label>
                    <select
                      value={editDocType}
                      onChange={(e) => setEditDocType(e.target.value)}
                      className="w-full bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
                    >
                      {DOC_TYPES.filter((t) => t.value !== "all").map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground block mb-1 uppercase tracking-wider">
                      Visibility
                    </label>
                    <select
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value)}
                      className="w-full bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
                    >
                      {VISIBILITY_OPTIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground block mb-1 uppercase tracking-wider">
                      Project
                    </label>
                    <select
                      value={editProjectId}
                      onChange={(e) => setEditProjectId(e.target.value)}
                      className="w-full bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
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
                    <label className="text-[9px] text-muted-foreground block mb-1 uppercase tracking-wider">
                      Tags
                    </label>
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="tag1, tag2, tag3"
                      className="w-full bg-muted/40 border border-border/40 rounded px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

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
              <svg
                className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                />
              </svg>
              <p className="text-sm font-medium">Knowledge Base</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                SOPs, guides, and references for your team and agents
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 text-sm bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] px-4 py-2 rounded"
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
                <label className="text-xs text-muted-foreground block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm"
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
                    className="w-full bg-muted/40 border border-border/40 rounded px-2 py-2 text-sm"
                  >
                    {DOC_TYPES.filter((t) => t.value !== "all").map((t) => (
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
                    className="w-full bg-muted/40 border border-border/40 rounded px-2 py-2 text-sm"
                  >
                    {VISIBILITY_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
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
                    className="w-full bg-muted/40 border border-border/40 rounded px-2 py-2 text-sm"
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
                    className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm"
                    placeholder="onboarding, engineering"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Initial content (markdown)
                </label>
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
                onClick={() => {
                  setShowCreate(false);
                  setNewTitle("");
                  setNewContent("");
                  setNewDocType("general");
                  setNewVisibility("company");
                  setNewTags("");
                  setNewProjectId("");
                }}
                className="text-sm px-4 py-2 rounded border border-border/40 hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={createDoc}
                disabled={creating || !newTitle.trim()}
                className="text-sm px-4 py-2 rounded bg-[var(--accent-soft)] hover:bg-[var(--accent-medium)] text-[var(--accent)] disabled:opacity-50"
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
