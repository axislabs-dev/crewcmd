"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-medium)] border-t-neo" />
      </div>
    }>
      <WorkspaceContent />
    </Suspense>
  );
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["memory"]));
  const [initialFileLoaded, setInitialFileLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/workspace/files")
      .then((r) => r.json())
      .then((data) => {
        setTree(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setSaved(false);
    setRawMode(false);
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content);
        setOriginalContent(data.content);
        setSelectedFile(filePath);
      }
    } catch {
      // ignore
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Deep-link: auto-open file from ?file= query param (e.g. from project doc links)
  useEffect(() => {
    if (initialFileLoaded || loading) return;
    const fileParam = searchParams.get("file");
    if (fileParam) {
      setInitialFileLoaded(true);
      const dir = fileParam.split("/").slice(0, -1).join("/");
      if (dir) {
        setExpandedDirs((prev) => new Set([...prev, dir]));
      }
      loadFile(fileParam);
    }
  }, [searchParams, loading, initialFileLoaded, loadFile]);

  async function saveFile() {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const res = await fetch("/api/workspace/file", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content }),
      });
      if (res.ok) {
        setOriginalContent(content);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = content !== originalContent;

  function toggleDir(dirPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  function renderFileTree(nodes: FileNode[]) {
    return (
      <ul className="space-y-0.5">
        {nodes.map((node) => {
          if (node.type === "directory") {
            const expanded = expandedDirs.has(node.path);
            return (
              <li key={node.path}>
                <button
                  onClick={() => toggleDir(node.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
                >
                  <svg
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                  <svg className="h-4 w-4 shrink-0 text-yellow-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                  </svg>
                  <span>{node.name}/</span>
                </button>
                {expanded && node.children && (
                  <div className="ml-3 border-l border-[var(--border-subtle)] pl-2">
                    {renderFileTree(node.children)}
                  </div>
                )}
              </li>
            );
          }

          const isSelected = selectedFile === node.path;
          return (
            <li key={node.path}>
              <button
                onClick={() => loadFile(node.path)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] tracking-wider transition-colors ${
                  isSelected
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <span className="truncate">{node.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
              WORKSPACE
            </h1>
            <p className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
              WORKSPACE FILES
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-medium)] border-t-neo" />
          </div>
        ) : (
          <div className="flex gap-4" style={{ height: "calc(100vh - 140px)" }}>
            {/* Left pane: file tree */}
            <div className="glass-card w-64 shrink-0 overflow-y-auto p-3">
              <div className="mb-3 text-[9px] tracking-[0.2em] text-[var(--text-tertiary)]">
                FILES
              </div>
              {tree.length === 0 ? (
                <p className="px-2 font-mono text-[10px] text-[var(--text-tertiary)]">
                  No workspace files found
                </p>
              ) : (
                renderFileTree(tree)
              )}
            </div>

            {/* Right pane: editor */}
            <div className="glass-card flex min-w-0 flex-1 flex-col overflow-hidden">
              {!selectedFile ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      Select a file to view or edit
                    </p>
                  </div>
                </div>
              ) : fileLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-medium)] border-t-neo" />
                </div>
              ) : (
                <>
                  {/* Toolbar */}
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] tracking-wider text-[var(--text-secondary)]">
                        {selectedFile}
                      </span>
                      {hasChanges && (
                        <span className="rounded-full bg-yellow-400/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-yellow-400">
                          MODIFIED
                        </span>
                      )}
                      {saved && (
                        <span className="rounded-full bg-green-400/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-green-400">
                          SAVED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex overflow-hidden rounded-lg border border-[var(--border-medium)]">
                        <button
                          onClick={() => setRawMode(false)}
                          className={`px-3 py-1 font-mono text-[10px] tracking-wider transition-colors ${
                            !rawMode
                              ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                          }`}
                        >
                          RENDER
                        </button>
                        <button
                          onClick={() => setRawMode(true)}
                          className={`px-3 py-1 font-mono text-[10px] tracking-wider transition-colors ${
                            rawMode
                              ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                          }`}
                        >
                          RAW
                        </button>
                      </div>
                      <button
                        onClick={saveFile}
                        disabled={saving || !hasChanges}
                        className="rounded-lg bg-[var(--accent-soft)] px-4 py-1.5 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-medium)] disabled:opacity-30"
                      >
                        {saving ? "SAVING..." : "SAVE"}
                      </button>
                    </div>
                  </div>

                  {/* Content area */}
                  <div className="flex-1 overflow-y-auto">
                    {rawMode ? (
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)] outline-none"
                        spellCheck={false}
                      />
                    ) : (
                      <div className="prose prose-invert max-w-none p-4 font-mono text-xs leading-relaxed text-[var(--text-secondary)] prose-headings:font-mono prose-headings:tracking-wider prose-headings:text-[var(--text-primary)] prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-p:text-[var(--text-secondary)] prose-a:text-[var(--accent)] prose-strong:text-[var(--text-primary)] prose-code:rounded prose-code:bg-[var(--bg-surface-hover)] prose-code:px-1 prose-code:py-0.5 prose-code:text-[var(--accent)]/80 prose-pre:border prose-pre:border-[var(--border-subtle)] prose-pre:bg-[var(--bg-surface)] prose-li:text-[var(--text-secondary)] prose-hr:border-[var(--border-medium)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
