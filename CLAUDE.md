# CLAUDE.md — CrewCmd

## What is CrewCmd?

AI-native workspace where humans and AI agents work side by side. Same task board, same org chart, same inbox. A team of 3 operates like a team of 30.

**Repo:** `axislabs-dev/crewcmd` | **License:** BSL 1.1 (RSCreative Technologies)

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack) + React 19
- **Styling:** Tailwind CSS + clsx/tailwind-merge
- **ORM:** Drizzle ORM
- **Database:** Neon (serverless Postgres) in production, PGlite (in-browser) for zero-config dev
- **Auth:** Auth.js (next-auth v5 beta) with email/password, multi-tenant via companies
- **Storage:** Vercel Blob

## Project Structure

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
│   ├── agent-config-fields.tsx  # Agent config (provider, model, skills)
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
    └── resolve-adapter-from-skills.ts  # Skills → execution adapter mapping
```

## Database Schema (key tables)

| Table | Purpose |
|---|---|
| `companies` | Multi-tenant orgs |
| `company_members` | User ↔ company membership |
| `users` | Auth users |
| `agents` | AI agents (provider, model, adapter_type, config) |
| `agent_skills` | Skills installed on agents (many-to-many) |
| `skills` | Available skills (built-in + custom) |
| `company_provider_keys` | LLM provider API keys per company |
| `tasks` | Task board items |
| `goals` | Company-level goals |
| `projects` | Project groupings |
| `org_chart_nodes` | Hierarchical org chart |
| `agent_budgets` | Per-agent spend budgets |
| `cost_events` | Token/cost tracking |
| `approval_gates` | Governance rules |
| `approval_requests` | Pending approvals |
| `heartbeat_schedules` | Agent wake schedules |
| `heartbeat_executions` | Execution run logs |
| `inbox_messages` | Agent inbox items |
| `team_blueprints` | Reusable team templates |
| `escalation_paths` | Escalation routing |
| `config_versions` | Agent config version history |
| `audit_log` | All mutations logged |
| `activity_log` | Activity feed |

## Architecture: Provider + Skills

Agents are configured with three orthogonal concepts:

1. **Provider** — the LLM brain (anthropic, openai, google, openrouter). Models fetched dynamically from provider APIs.
2. **Skills** — installable capabilities (Claude Code, Codex, GitHub, etc.). Each skill defines runtime, command, and provider compatibility.
3. **Execution** — derived from installed skills. Primary CLI skill determines which adapter runs the agent. Falls back to legacy `adapter_type` if no skills installed.

Built-in skills: claude-code, codex, opencode, gemini-cli, cursor, pi, github, web-browse, file-system, shell.

See `doc/design/provider-skills-architecture.md` for the full RFC.

## API Routes

All under `src/app/api/`. Key groups:

- `/api/agents` — CRUD, start/stop, output streaming, skills, heartbeat
- `/api/tasks` — CRUD, comments, images, time entries
- `/api/skills` — list (merges built-in + custom), CRUD, browse marketplace, import
- `/api/providers/[provider]/models` — dynamic model list from provider API (cached 1hr)
- `/api/provider-keys` — company provider API key management
- `/api/goals`, `/api/projects` — goal and project management
- `/api/budgets`, `/api/cost-events` — budget and cost tracking
- `/api/approval-gates`, `/api/approval-requests` — governance
- `/api/heartbeat-schedules`, `/api/heartbeat-executions` — agent scheduling
- `/api/org-chart` — org hierarchy
- `/api/inbox` — agent inbox with bulk operations
- `/api/blueprints` — team templates (deploy creates agents + org chart)
- `/api/companies` — multi-tenant company management
- `/api/auth` — signup, session status
- `/api/openclaw` — OpenClaw gateway integration (agents, nodes, health)

## UI Modes

Two modes controlled by `mode-provider.tsx`:

- **Simple mode** — streamlined vocabulary, hides advanced features
- **Pro mode** — full feature set with technical terminology

## Development

```bash
# Install
pnpm install

# Dev (PGlite, zero-config, no DB setup needed)
pnpm dev

# With Neon (set DATABASE_URL in .env.local)
pnpm dev

# Build
pnpm build

# Typecheck
pnpm typecheck

# Generate migration after schema changes
pnpm db:generate

# Run migrations
pnpm db:migrate
```

## Environment Variables

- `DATABASE_URL` — Neon connection string (omit for PGlite dev mode)
- `AUTH_SECRET` — Auth.js secret
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage

Provider API keys are stored per-company in the DB, not as env vars.

## Code Conventions

- Atomic commits with conventional commit messages
- Pre-commit hooks: lint-staged + typecheck
- `withRetry()` wrapper for all Neon queries (cold start handling)
- API routes return `NextResponse.json()`
- UI uses glass-card dark theme pattern throughout
- Components use clsx + tailwind-merge for conditional classes

## Key Concepts

- **Heartbeats** — agents wake on a schedule, check work, act, exit. Not continuously running.
- **Org chart** — hierarchical agent reporting structure. Delegation flows up and down.
- **Blueprints** — reusable team templates. Deploy creates agents + wires up org chart.
- **Governance** — approval gates require human sign-off before agents act on certain operations.
- **Cost control** — per-agent budgets with automatic tracking via cost events.
- **Inbox** — centralized message queue for agent-to-agent and human-to-agent communication.
