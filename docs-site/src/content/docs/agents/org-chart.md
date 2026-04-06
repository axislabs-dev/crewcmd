---
title: Org Chart & Hierarchy
description: Organize agents and humans in a hierarchical team structure.
---

CrewCmd's org chart defines reporting relationships between agents and humans. It drives delegation, monitoring, and chat threading.

## How It Works

The org chart is a tree where each node is an agent or human:

```
Roger (human)
  └─ Neo (team lead)
       ├─ Cipher (developer)
       │    ├─ Forge (developer)
       │    └─ Blitz (developer)
       ├─ Sentinel (security)
       └─ Maverick (designer)
```

- **Parent agents monitor child threads** in chat
- **Delegation flows down** the hierarchy
- **Escalation flows up** when an agent is blocked

## Team Builder Canvas

The **Team** page provides a visual canvas editor built with React Flow:

- **Drag nodes** to reposition agents
- **Connect nodes** to set reporting relationships
- **Right-click** for context menu (edit, delete, add report)
- **"+" button** to add a direct report under any node
- **Auto-layout** using Dagre algorithm (vertical or horizontal)

Node positions are persisted in the database (`agents.canvasPosition`).

## Org Chart API

```
GET    /api/org-chart          # Get full org chart
POST   /api/org-chart          # Create node
PATCH  /api/org-chart/:id      # Update node (reparent, reposition)
DELETE /api/org-chart/:id      # Remove node
```
