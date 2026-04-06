---
title: Project Structure
description: How the CrewCmd codebase is organized.
---

CrewCmd follows standard Next.js App Router conventions with a few additional directories for database, libraries, and components.

## Directory Layout

```
src/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/                # ~35 API route groups
│   ├── agents/             # Agent list + detail pages
│   ├── tasks/              # Task board
│   ├── inbox/              # Agent inbox
│   ├── goals/              # Company goals
│   ├── skills/             # Skills marketplace + management
│   ├── blueprints/         # Team blueprint templates
│   ├── budgets/            # Agent budget tracking
│   ├── governance/         # Approval gates
│   ├── heartbeats/         # Heartbeat schedule management
│   ├── office/             # Virtual office view
│   ├── team/               # Org chart
│   ├── chat/               # Chat interface
│   ├── settings/           # Company settings + provider keys
│   └── onboarding/         # First-run setup
├── components/             # Shared React components
│   ├── ui/                 # Primitives (buttons, dialogs, etc.)
│   ├── agent-card.tsx      # Agent display with skill badges
│   ├── task-board.tsx      # Kanban board
│   ├── org-chart.tsx       # Org chart visualization
│   └── sidebar.tsx         # Navigation
├── db/
│   ├── schema.ts           # Main Drizzle schema (30+ tables)
│   ├── schema-access.ts    # Access grant schema
│   ├── schema-inbox.ts     # Inbox schema
│   ├── pglite.ts           # PGlite dev adapter
│   ├── index.ts            # DB connection (Neon or PGlite)
│   └── seed.ts             # Seed data
└── lib/
    ├── skills/
    │   └── built-in.ts     # Built-in execution skills registry
    └── resolve-adapter-from-skills.ts
```

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `companies` | Multi-tenant organizations |
| `agents` | AI agents (provider, model, adapter, config) |
| `agent_skills` | Skills installed on agents (many-to-many) |
| `skills` | Available skills (built-in + custom) |
| `tasks` | Task board items |
| `goals` | Company-level goals |
| `org_chart_nodes` | Hierarchical org chart |
| `agent_budgets` | Per-agent spend budgets |
| `cost_events` | Token/cost tracking |
| `approval_gates` | Governance rules |
| `heartbeat_schedules` | Agent wake schedules |
| `inbox_messages` | Agent inbox items |
| `team_blueprints` | Reusable team templates |
| `audit_log` | All mutations logged |

## UI Modes

CrewCmd has two UI modes controlled by `mode-provider.tsx`:

- **Simple mode** — Streamlined vocabulary, hides advanced features. Ideal for non-technical users.
- **Pro mode** — Full feature set with technical terminology. For power users and developers.
