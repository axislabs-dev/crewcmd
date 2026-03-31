"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface OrgTreeNode {
  id: string;
  agentId: string;
  positionTitle: string;
  canDelegate: boolean;
  sortIndex: number;
  children: OrgTreeNode[];
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

interface FlatNode {
  id: string;
  agentId: string;
  positionTitle: string;
  parentNodeId: string | null;
  canDelegate: boolean;
  sortIndex: number;
}

export default function OrgChartPage() {
  const [tree, setTree] = useState<OrgTreeNode[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [flatNodes, setFlatNodes] = useState<FlatNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editNode, setEditNode] = useState<FlatNode | null>(null);
  const [formAgentId, setFormAgentId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formParentId, setFormParentId] = useState("");
  const [formCanDelegate, setFormCanDelegate] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [treeRes, agentsRes] = await Promise.all([
        fetch(`/api/org-chart?company_id=${cId}`),
        fetch("/api/agents"),
      ]);
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        setTree(treeData);
        // Build flat list from tree for parent dropdown
        const flat: FlatNode[] = [];
        function flatten(nodes: OrgTreeNode[], parentId: string | null) {
          for (const n of nodes) {
            flat.push({
              id: n.id,
              agentId: n.agentId,
              positionTitle: n.positionTitle,
              parentNodeId: parentId,
              canDelegate: n.canDelegate,
              sortIndex: n.sortIndex,
            });
            flatten(n.children, n.id);
          }
        }
        flatten(treeData, null);
        setFlatNodes(flat);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(Array.isArray(data) ? data : data.agents ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("active_company="));
    const cId = cookie?.split("=")[1] ?? null;
    setCompanyId(cId);
    if (cId) fetchData(cId);
    else setLoading(false);
  }, [fetchData]);

  function getAgent(callsign: string) {
    return agents.find((a) => a.callsign === callsign);
  }

  function openCreate() {
    setEditNode(null);
    setFormAgentId("");
    setFormTitle("");
    setFormParentId("");
    setFormCanDelegate(true);
    setShowModal(true);
  }

  function openEdit(node: FlatNode) {
    setEditNode(node);
    setFormAgentId(node.agentId);
    setFormTitle(node.positionTitle);
    setFormParentId(node.parentNodeId ?? "");
    setFormCanDelegate(node.canDelegate);
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formAgentId || !formTitle) return;
    setSaving(true);
    try {
      const res = await fetch("/api/org-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editNode?.id,
          companyId,
          agentId: formAgentId,
          positionTitle: formTitle,
          parentNodeId: formParentId || null,
          canDelegate: formCanDelegate,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        fetchData(companyId);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(nodeId: string) {
    try {
      await fetch(`/api/org-chart/${nodeId}`, { method: "DELETE" });
      if (companyId) fetchData(companyId);
    } catch {
      // ignore
    }
  }

  function TreeNode({ node, depth }: { node: OrgTreeNode; depth: number }) {
    const agent = getAgent(node.agentId);
    const reportCount = node.children.length;

    return (
      <div className={depth > 0 ? "ml-8 border-l border-white/[0.06] pl-4" : ""}>
        <div className="group flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 transition-colors hover:border-white/[0.08] hover:bg-white/[0.02]">
          {/* Agent info */}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-lg">
            {agent?.emoji ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/agents/${node.agentId}`}
                className="font-mono text-xs font-bold text-white/80 hover:text-neo transition-colors"
              >
                {agent?.name ?? node.agentId}
              </Link>
              {node.canDelegate && (
                <span className="rounded bg-neo/10 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-neo/60">
                  CAN DELEGATE
                </span>
              )}
            </div>
            <p className="font-mono text-[10px] text-white/30">{node.positionTitle}</p>
          </div>

          {/* Report count */}
          {reportCount > 0 && (
            <span className="font-mono text-[10px] text-white/25">
              {reportCount} report{reportCount !== 1 ? "s" : ""}
            </span>
          )}

          {/* Edit / Delete */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() =>
                openEdit({
                  id: node.id,
                  agentId: node.agentId,
                  positionTitle: node.positionTitle,
                  parentNodeId: null,
                  canDelegate: node.canDelegate,
                  sortIndex: node.sortIndex,
                })
              }
              className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/50"
              title="Edit"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button
              onClick={() => handleDelete(node.id)}
              className="rounded p-1 text-red-400/40 hover:bg-red-500/10 hover:text-red-400"
              title="Remove"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Children */}
        {node.children.length > 0 && (
          <div className="mt-1 space-y-1">
            {node.children.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="font-mono text-sm text-white/30">Loading...</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-sm text-white/40">No company selected</p>
          <p className="mt-1 font-mono text-xs text-white/25">
            Select a company from the sidebar to view the org chart.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-wider text-neo">TEAM</h1>
          <p className="mt-1 font-mono text-xs text-white/30">
            Agent hierarchy &amp; delegation structure
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30"
        >
          + ADD POSITION
        </button>
      </div>

      {/* Tree */}
      <div className="mt-6 space-y-1">
        {tree.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] py-16 text-center">
            <p className="font-mono text-xs text-white/30">No org chart configured</p>
            <p className="mt-1 font-mono text-[10px] text-white/20">
              Add positions to build your agent hierarchy.
            </p>
            <button
              onClick={openCreate}
              className="mt-4 rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30"
            >
              ADD FIRST POSITION
            </button>
          </div>
        ) : (
          tree.map((node) => <TreeNode key={node.id} node={node} depth={0} />)
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-bg-primary p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-neo">
              {editNode ? "EDIT POSITION" : "ADD POSITION"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">AGENT</label>
                <select
                  value={formAgentId}
                  onChange={(e) => setFormAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.callsign} value={a.callsign}>
                      {a.emoji} {a.name} ({a.callsign})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">POSITION TITLE</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. CEO, Engineering Lead"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">REPORTS TO</label>
                <select
                  value={formParentId}
                  onChange={(e) => setFormParentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">None (root position)</option>
                  {flatNodes
                    .filter((n) => n.id !== editNode?.id)
                    .map((n) => {
                      const a = getAgent(n.agentId);
                      return (
                        <option key={n.id} value={n.id}>
                          {a?.emoji ?? "?"} {a?.name ?? n.agentId} — {n.positionTitle}
                        </option>
                      );
                    })}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormCanDelegate(!formCanDelegate)}
                  className={`h-5 w-9 rounded-full transition-colors ${
                    formCanDelegate ? "bg-neo/40" : "bg-white/[0.08]"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      formCanDelegate ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="font-mono text-[10px] tracking-wider text-white/40">
                  CAN DELEGATE TASKS
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-xs text-white/40 transition-colors hover:bg-white/[0.04]"
              >
                CANCEL
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formAgentId || !formTitle}
                className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {saving ? "SAVING..." : editNode ? "UPDATE" : "ADD"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
