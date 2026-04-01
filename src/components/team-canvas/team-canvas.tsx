"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnConnect,
  type NodeChange,
  BackgroundVariant,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { Agent } from "@/lib/data";
import { AgentNode, type AgentNodeData } from "./agent-node";

// ─── Types ──────────────────────────────────────────────────────────────

interface AgentSkillBadge {
  slug: string;
  name: string;
  icon: string;
}

interface TeamCanvasProps {
  agents: Agent[];
  agentSkills: Record<string, AgentSkillBadge[]>;
  onEdit: (callsign: string) => void;
  onAddChild: (parentCallsign: string) => void;
  onAssignTask: (agent: Agent) => void;
  onRefresh: () => void;
}

// ─── Dagre layout ───────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Build nodes and edges from agents ──────────────────────────────────

function buildNodesAndEdges(
  agents: Agent[],
  agentSkills: Record<string, AgentSkillBadge[]>,
  callbacks: {
    onEdit: (callsign: string) => void;
    onAddChild: (callsign: string) => void;
    onAssignTask: (agent: Agent) => void;
    onNavigate: (callsign: string) => void;
  }
): { nodes: Node[]; edges: Edge[] } {
  const callsignMap = new Map<string, Agent>();
  for (const a of agents) callsignMap.set(a.callsign.toLowerCase(), a);

  const nodes: Node[] = agents.map((agent) => ({
    id: agent.callsign.toLowerCase(),
    type: "agentNode",
    position: agent.canvasPosition ?? { x: 0, y: 0 },
    data: {
      agent,
      skills: agentSkills[agent.id] ?? [],
      ...callbacks,
    } satisfies AgentNodeData,
  }));

  const edges: Edge[] = [];
  for (const agent of agents) {
    if (agent.reportsTo && callsignMap.has(agent.reportsTo.toLowerCase())) {
      edges.push({
        id: `${agent.reportsTo.toLowerCase()}->${agent.callsign.toLowerCase()}`,
        source: agent.reportsTo.toLowerCase(),
        target: agent.callsign.toLowerCase(),
        type: "smoothstep",
        style: {
          stroke: callsignMap.get(agent.reportsTo.toLowerCase())?.color ?? "#555",
          strokeWidth: 2,
        },
        animated: ["working", "running"].includes(agent.status),
      });
    }
  }

  return { nodes, edges };
}

// ─── Canvas Inner (needs ReactFlow context) ─────────────────────────────

const nodeTypes = { agentNode: AgentNode };

function TeamCanvasInner({
  agents,
  agentSkills,
  onEdit,
  onAddChild,
  onAssignTask,
  onRefresh,
}: TeamCanvasProps) {
  const { fitView } = useReactFlow();
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasManualPositions = agents.some((a) => a.canvasPosition);

  const callbacks = useMemo(
    () => ({
      onEdit,
      onAddChild,
      onAssignTask,
      onNavigate: (callsign: string) => {
        window.location.href = `/agents/${callsign}`;
      },
    }),
    [onEdit, onAddChild, onAssignTask]
  );

  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildNodesAndEdges(agents, agentSkills, callbacks),
    [agents, agentSkills, callbacks]
  );

  // Apply dagre layout only if no agents have saved positions
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (hasManualPositions) {
      return { nodes: rawNodes, edges: rawEdges };
    }
    return getLayoutedElements(rawNodes, rawEdges, direction);
  }, [rawNodes, rawEdges, hasManualPositions, direction]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when agents data changes (status updates, etc.)
  const prevAgentKey = useRef("");
  useEffect(() => {
    const key = agents.map((a) => `${a.callsign}:${a.status}:${a.currentTask}`).join("|");
    if (key === prevAgentKey.current) return;
    prevAgentKey.current = key;

    // Update node data without changing positions
    setNodes((prev) => {
      const positionMap = new Map(prev.map((n) => [n.id, n.position]));
      return initialNodes.map((n) => ({
        ...n,
        position: positionMap.get(n.id) ?? n.position,
      }));
    });
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, agents, setNodes, setEdges]);

  // Save position on drag end
  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);

      // Batch position saves
      const positionChanges = changes.filter(
        (c) => c.type === "position" && "position" in c && c.position && !c.dragging
      );
      if (positionChanges.length > 0) {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
          for (const change of positionChanges) {
            if (change.type === "position" && "position" in change && change.position) {
              fetch(`/api/agents/${change.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  canvasPosition: { x: Math.round(change.position.x), y: Math.round(change.position.y) },
                }),
              }).catch(() => {});
            }
          }
        }, 300);
      }
    },
    [onNodesChange]
  );

  // Connect handler — reparent agent
  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target) return;
      // Update reportsTo for the target agent
      fetch(`/api/agents/${connection.target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportsTo: connection.source }),
      })
        .then((res) => {
          if (res.ok) onRefresh();
        })
        .catch(() => {});
    },
    [onRefresh]
  );

  // Auto-layout button
  const handleAutoLayout = useCallback(() => {
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      direction
    );
    setNodes(layouted);
    setEdges(layoutedEdges);
    // Save all positions
    for (const n of layouted) {
      fetch(`/api/agents/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasPosition: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        }),
      }).catch(() => {});
    }
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [nodes, edges, direction, setNodes, setEdges, fitView]);

  // Toggle direction
  const handleToggleDirection = useCallback(() => {
    const newDir = direction === "TB" ? "LR" : "TB";
    setDirection(newDir);
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      newDir
    );
    setNodes(layouted);
    setEdges(layoutedEdges);
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [direction, nodes, edges, setNodes, setEdges, fitView]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#333"
        />

        <Controls
          showInteractive={false}
          className="!bg-zinc-900/90 !border-zinc-700/60 !shadow-xl [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700/60 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-700 [&>button:hover]:!text-zinc-200"
        />

        <MiniMap
          nodeColor={(node) => {
            const data = node.data as unknown as AgentNodeData;
            return data?.agent?.color ?? "#555";
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-zinc-900/90 !border-zinc-700/60"
          pannable
          zoomable
        />

        {/* Top-right controls panel */}
        <Panel position="top-right" className="flex items-center gap-2">
          <button
            onClick={handleToggleDirection}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/90 px-3 py-1.5 text-[10px] tracking-wider text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 backdrop-blur-sm"
            title={direction === "TB" ? "Switch to horizontal" : "Switch to vertical"}
          >
            {direction === "TB" ? "↕ VERTICAL" : "↔ HORIZONTAL"}
          </button>
          <button
            onClick={handleAutoLayout}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/90 px-3 py-1.5 text-[10px] tracking-wider text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 backdrop-blur-sm"
            title="Auto-arrange nodes"
          >
            ⊞ AUTO-ARRANGE
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

// ─── Wrapped with Provider ──────────────────────────────────────────────

export function TeamCanvas(props: TeamCanvasProps) {
  return (
    <ReactFlowProvider>
      <TeamCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
