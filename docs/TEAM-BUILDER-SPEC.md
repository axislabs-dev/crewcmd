# Team Builder — Feature Spec

## Vision

The Team Builder is the product's center of gravity. It's a visual canvas where CEOs architect their AI workforce: dragging, connecting, and configuring agent nodes into an infinite org chart. Think Figma meets org design for AI teams.

This is where users will spend most of their time. It needs to feel premium, responsive, and powerful.

## Core Technology

- **@xyflow/react** (React Flow v12) — battle-tested, MIT licensed, built for exactly this
- **@dagrejs/dagre** — automatic tree layout (top-down org chart)
- Custom nodes, custom edges, full interactivity

## Architecture

### Canvas Layer (React Flow)

The canvas is the primary view of `/team`. It replaces the current list/tree view as the default, with list view available as a secondary toggle.

**Node types:**
- `agentNode` — Rich custom node: emoji avatar, callsign, name, title/role, status indicator, adapter badge, skill count. Styled with the agent's color accent.
- `addNode` — Ghost "+" node that appears at valid insertion points (end of branches, under any agent)

**Edge types:**
- `reportingEdge` — Styled connection line (agent's color, animated when agent is active/working). Represents `reportsTo` relationship.

**Interactions:**
1. **Drag to reposition** — Agents can be freely positioned on canvas. Positions saved to DB.
2. **Connect to reparent** — Drag from one agent's bottom handle to another's top handle to change reporting line. Updates `reportsTo` in DB.
3. **Disconnect** — Delete an edge to make an agent a top-level root.
4. **Click node** — Opens side panel with full agent config (same form as edit dialog).
5. **Double-click node** — Opens the agent profile page.
6. **Right-click context menu** — Edit, Delete, Add Report, Assign Task, Start/Stop.
7. **"+" button on each node** — Adds a new agent as a direct report. Opens create dialog with `reportsTo` pre-filled.
8. **Drag from palette** — A sidebar palette of "New Agent" templates or blueprint agents that can be dragged onto the canvas.

### Auto-Layout

- **Dagre** handles initial layout (top-down tree)
- Layout direction toggle: vertical (TB) or horizontal (LR)
- "Auto-arrange" button re-runs Dagre on current nodes
- Once a user manually positions nodes, their positions persist. Auto-arrange is opt-in.

### Canvas Controls

- **Minimap** — Bottom-right, shows full org at a glance
- **Zoom controls** — +/- buttons, fit-to-view, zoom-to-selection
- **Background** — Subtle dot grid pattern
- **Pan** — Click-drag on canvas background
- **Multi-select** — Shift+click or drag-to-select rectangle
- **Keyboard shortcuts** — Delete (remove), Ctrl+A (select all), Ctrl+Z (undo — stretch goal)

### Side Panel (Detail View)

When a node is selected, a slide-out panel on the right shows:
- Full agent identity (avatar, name, callsign, role)
- Status and runtime controls (start/stop/restart)
- Current task (if any)
- Configuration tabs:
  - **Identity** — Name, callsign, emoji, color, role, reportsTo
  - **Adapter** — Type, provider, model, command, workspace
  - **Skills** — Assigned skills with toggle
  - **Policy** — Heartbeat, timeout, concurrency
  - **Activity** — Recent tasks, token usage, last active

### Data Flow

```
Canvas (React Flow state)
  ↕ sync
Agent DB (Drizzle/Neon)
  ↕ API
/api/agents (CRUD)
/api/agents/[callsign] (PATCH reportsTo, position)
```

**New DB field needed:**
- `agents.canvasPosition` — `jsonb`, stores `{ x: number, y: number }` or null (auto-layout)

**API changes:**
- PATCH `/api/agents/[callsign]` already supports all fields. Just need to add `canvasPosition` to schema + allow list.

### State Management

- React Flow's `useNodesState` / `useEdgesState` for canvas state
- Agents fetched from API on mount, converted to React Flow nodes/edges
- Changes (reposition, reparent, create, delete) trigger API calls
- Optimistic updates with rollback on failure
- Auto-refresh every 15s for status updates (lightweight: only update status/task, don't clobber positions)

## Node Design (Visual)

```
┌─────────────────────────────┐
│ [color bar]                 │
│                             │
│  🕶️  NEO           ● ONLINE │
│  CEO · Claude              │
│  ────────────────────────  │
│  ⚡ web  🔍 search  📧 email │
│                      [+ ▼] │
└──────────────○──────────────┘
               │ (source handle, bottom center)
```

- Top edge: colored bar matching agent.color
- Emoji avatar on left
- Callsign bold + colored, name underneath
- Status dot + label
- Role + adapter badge
- Skills as mini badges (max 3, +N more)
- Bottom: source handle for connecting to reports
- Top: target handle for receiving reporting connections
- "+" button (bottom-right) to add a direct report
- Hover: subtle glow in agent's color

**Dimensions:** ~220px wide, ~120px tall (auto-height based on content)

## Empty State

When no agents exist:
- Center of canvas shows a large friendly prompt
- "Build Your Team" heading
- Two CTAs: "Start from Blueprint" and "Create First Agent"
- Background still shows the grid

## Blueprint Integration

- Deploying a blueprint creates agents AND positions them on the canvas
- Blueprint preview shows the React Flow layout (read-only) before deployment
- Post-deploy, canvas animates the new nodes appearing

## Mobile / Responsive

- Canvas works on tablet (pinch-to-zoom, touch-drag)
- On small screens (<768px), default to list view with canvas as opt-in
- Side panel becomes bottom sheet on mobile

## Performance

- React Flow handles 100+ nodes smoothly
- Virtualization built into React Flow
- Only visible nodes render DOM elements
- Lightweight status polling (don't refetch full agent configs)

## Implementation Plan

### Phase 1: Canvas Foundation (Now)
1. Install `@xyflow/react` + `@dagrejs/dagre`
2. Add `canvasPosition` to agents schema
3. Build custom `AgentNode` component
4. Build canvas page with auto-layout
5. Wire to API: load agents → render nodes/edges
6. Save positions on drag-end
7. Connect/disconnect to change reportsTo
8. Click-to-select + side panel (reuse edit form)
9. "+" button to add direct report
10. Minimap + controls + background

### Phase 2: Polish
- Context menu (right-click)
- Keyboard shortcuts
- Animation on status changes
- Blueprint preview in React Flow
- Drag-from-palette (new agent templates)

### Phase 3: Advanced
- Undo/redo
- Canvas sharing / export as image
- Team analytics overlay (cost per branch, performance)
- Automation paths (visual workflow on top of org chart)
- Multi-select bulk operations
