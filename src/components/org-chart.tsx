import Link from "next/link";
import type { Agent } from "@/lib/data";

interface OrgChartProps {
  agents: Agent[];
}

interface TreeNode {
  agent: Agent;
  children: TreeNode[];
}

/** Build a tree from the flat agent list using reportsTo. */
function buildTree(agents: Agent[]): TreeNode[] {
  const agentMap = new Map<string, Agent>();
  for (const a of agents) {
    agentMap.set(a.id, a);
    agentMap.set(a.callsign.toLowerCase(), a);
    agentMap.set(`agent-${a.callsign.toLowerCase()}`, a);
  }

  const childrenMap = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];

  for (const agent of agents) {
    const node: TreeNode = { agent, children: [] };

    if (!agent.reportsTo) {
      roots.push(node);
    } else {
      const parentKey = agent.reportsTo;
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, []);
      }
      childrenMap.get(parentKey)!.push(node);
    }
  }

  // Attach children to their parents
  function attachChildren(node: TreeNode): TreeNode {
    const possibleKeys = [
      node.agent.id,
      node.agent.callsign.toLowerCase(),
      `agent-${node.agent.callsign.toLowerCase()}`,
    ];
    for (const key of possibleKeys) {
      const children = childrenMap.get(key);
      if (children) {
        node.children.push(...children);
        childrenMap.delete(key);
      }
    }
    node.children.forEach(attachChildren);
    return node;
  }

  roots.forEach(attachChildren);

  // Any orphans with unresolved parents become roots
  for (const orphans of childrenMap.values()) {
    roots.push(...orphans);
  }

  return roots;
}

export function OrgChart({ agents }: OrgChartProps) {
  const tree = buildTree(agents);

  if (tree.length === 0) {
    return (
      <section>
        <div className="mb-4">
          <h2 className="text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
            Org Chart
          </h2>
        </div>
        <div className="glass-card p-8 text-center text-sm text-[var(--text-tertiary)]">
          No agents yet. Create agents and set their reporting structure to build your org chart.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
          Org Chart
        </h2>
      </div>

      <div className="glass-card overflow-x-auto p-6">
        <div className="flex flex-col items-center gap-0 min-w-[400px]">
          {tree.length === 1 ? (
            <TreeNodeView node={tree[0]} />
          ) : (
            <div className="relative flex items-start justify-center gap-16">
              <HorizontalLine />
              {tree.map((root) => (
                <div key={root.agent.id} className="flex flex-col items-center">
                  <TreeNodeView node={root} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TreeNodeView({ node, compact }: { node: TreeNode; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <AgentOrgNode agent={node.agent} compact={compact} />
      {node.children.length > 0 && (
        <>
          <VerticalLine />
          {node.children.length === 1 ? (
            <TreeNodeView node={node.children[0]} compact />
          ) : (
            <div className="relative flex items-start justify-center gap-8">
              <HorizontalLineSm count={node.children.length} />
              {node.children.map((child) => (
                <div key={child.agent.id} className="flex flex-col items-center">
                  <VerticalLineShort />
                  <TreeNodeView node={child} compact />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentOrgNode({
  agent,
  compact,
}: {
  agent: Agent;
  compact?: boolean;
}) {
  return (
    <Link
      href="/team"
      className="group flex flex-col items-center transition-transform duration-200 hover:scale-105"
    >
      <div
        className={`flex flex-col items-center rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] transition-all duration-300 group-hover:bg-[var(--bg-surface-hover)] ${
          compact ? "px-3 py-2" : "px-5 py-3"
        }`}
        style={{
          boxShadow: `0 0 0 1px ${agent.color}15`,
        }}
      >
        <span className={compact ? "text-lg" : "text-2xl"}>{agent.emoji}</span>
        <span
          className={`font-mono font-bold tracking-wider ${
            compact ? "text-[10px]" : "text-xs"
          }`}
          style={{ color: agent.color }}
        >
          {agent.callsign.toUpperCase()}
        </span>
        <span
          className={`text-center text-[var(--text-tertiary)] ${
            compact ? "max-w-[80px] text-[8px]" : "text-[10px]"
          }`}
        >
          {agent.title}
        </span>
        <div className="mt-1 flex items-center gap-1">
          <span className={`status-dot status-dot-${agent.status}`} />
        </div>
      </div>
    </Link>
  );
}

function VerticalLine() {
  return (
    <div className="h-8 w-px bg-gradient-to-b from-[var(--text-tertiary)] to-transparent" />
  );
}

function VerticalLineShort() {
  return (
    <div className="h-5 w-px bg-gradient-to-b from-[var(--text-tertiary)] to-transparent" />
  );
}

function HorizontalLine() {
  return (
    <div
      className="absolute top-0 left-1/2 h-px -translate-x-1/2 bg-gradient-to-r from-transparent via-[var(--border-subtle)] to-transparent"
      style={{ width: "calc(100% - 40px)" }}
    />
  );
}

function HorizontalLineSm({ count }: { count: number }) {
  return (
    <div
      className="absolute top-0 left-1/2 h-px -translate-x-1/2 bg-gradient-to-r from-transparent via-[var(--border-subtle)] to-transparent"
      style={{ width: `${Math.max(count - 1, 1) * 80 + 40}px` }}
    />
  );
}
