# CrewCmd — CLAUDE.md

> Open-source agent crew orchestration. Your crew. Your command.

## What This Is

CrewCmd is a self-hosted, open-source platform for orchestrating teams of AI agents alongside humans. Task management, org charts, budgets, governance, skills, and agent execution in one dashboard. Born from Axislabs' internal Mission Control, rebuilt as a standalone product.

**Repo:** [github.com/axislabs-dev/crewcmd](https://github.com/axislabs-dev/crewcmd)
**License:** BSL 1.1 (converts to Apache 2.0 on 2030-03-31)
**Licensor:** RSCreative Technologies Pty Ltd

---

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui components |
| ORM | Drizzle |
| Database | PGlite (embedded, zero-config local dev) or external Postgres (Neon, Supabase, self-hosted) |
| Auth | NextAuth v5 (email/password + GitHub OAuth) |
| Hosting | Self-hosted, Vercel, or Docker |
| Real-time | Polling (WebSocket/SSE planned) |

---

## Architecture Overview

### Core Entities

- **Companies** — Multi-tenant isolation. Each company has its own agents, tasks, projects, goals, budgets, and settings.
- **Users** — Email/password or GitHub OAuth. Roles: super_admin, admin, viewer. Company-scoped roles: owner, admin, member, viewer.
- **Agents** — AI team members with callsigns, adapters, roles, visibility tiers, skills, and budget controls.
- **Tasks** — Full lifecycle: backlog → inbox → queued → assigned → in_progress → review → done/failed/blocked. PR tracking, comments, images, time entries.
- **Projects** — Group tasks under projects, link to goals, track context.
- **Goals** — Hierarchical goal trees (company mission → project goals → agent goals → tasks).
- **Skills** — Agent capabilities from ClawHub, skills.sh, GitHub, or custom. Many-to-many with agents.
- **Blueprints** — Pre-built team templates for one-click agent team deployment.
- **Inbox** — Centralized communication hub with priority tiers and action buttons.

### Agent Adapters

Agents connect via adapters. Current adapter types:
- `openclaw_gateway` — Direct OpenClaw integration
- `openrouter` — OpenRouter API
- `http` — Generic HTTP/API agents
- Custom adapters via adapter config

### Agent Execution

Runtime engine with adapter-specific executors. Agent control panel UI with terminal output, task assignment from dialog.

### Access Control

Three-tier agent visibility:
- **Private** — Only the creator can see/use
- **Assigned** — Specific users granted access (via `agent_access_grants`)
- **Team** — Visible to all company members

Per-user permissions: interact, configure, view logs.

### UI Modes

- **Simple mode** — Hides technical complexity for non-technical users
- **Pro mode** — Full access to all features, configs, and internals

---

## Repository Structure

```
crewcmd/
├── CLAUDE.md              # This file
├── README.md              # Public-facing docs
├── LICENSE                # BSL 1.1
├── package.json
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── drizzle/               # DB migrations
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── api/           # REST API endpoints
│   │   │   ├── agents/
│   │   │   ├── tasks/
│   │   │   ├── projects/
│   │   │   ├── companies/
│   │   │   ├── goals/
│   │   │   ├── budgets/
│   │   │   ├── cost-events/
│   │   │   ├── skills/
│   │   │   ├── blueprints/
│   │   │   ├── inbox/
│   │   │   ├── runtime/
│   │   │   ├── approval-gates/
│   │   │   ├── approval-requests/
│   │   │   ├── audit-log/
│   │   │   ├── config-versions/
│   │   │   ├── escalation-paths/
│   │   │   ├── heartbeat-schedules/
│   │   │   ├── heartbeat-executions/
│   │   │   ├── routines/
│   │   │   ├── org-chart/
│   │   │   ├── openclaw/
│   │   │   ├── webhooks/
│   │   │   ├── workspace/
│   │   │   └── ...
│   │   ├── dashboard/
│   │   ├── agents/
│   │   ├── tasks/
│   │   ├── projects/
│   │   ├── goals/
│   │   ├── budgets/
│   │   ├── team/           # Consolidated org chart + team view
│   │   ├── inbox/
│   │   ├── skills/
│   │   ├── blueprints/
│   │   ├── automations/    # Renamed from /routines
│   │   ├── heartbeats/
│   │   ├── escalations/
│   │   ├── governance/
│   │   ├── chat/           # Voice/text chat with STT/TTS
│   │   ├── docs/
│   │   ├── documents/
│   │   ├── schedules/
│   │   ├── office/
│   │   ├── settings/
│   │   └── onboarding/
│   ├── components/
│   │   ├── ui/             # shadcn/ui primitives
│   │   ├── sidebar.tsx
│   │   ├── task-board.tsx
│   │   ├── task-table.tsx
│   │   ├── task-dialog.tsx
│   │   ├── org-chart.tsx
│   │   ├── agent-card.tsx
│   │   ├── agent-config-fields.tsx
│   │   ├── agent-control-panel.tsx
│   │   ├── agent-output-viewer.tsx
│   │   ├── new-agent-dialog.tsx
│   │   ├── company-switcher.tsx
│   │   ├── welcome-hero.tsx
│   │   ├── mode-toggle.tsx  # Simple/Pro mode
│   │   └── ...
│   ├── db/
│   │   ├── schema.ts       # All tables and enums
│   │   └── seed.ts
│   └── lib/
│       ├── auth.ts
│       ├── adapters/        # Agent adapter implementations
│       ├── agent-runtime.ts # Execution engine
│       ├── blueprints-data.ts
│       ├── budget.ts
│       ├── company.ts
│       ├── delegation.ts
│       ├── escalation.ts
│       ├── governance.ts
│       ├── heartbeat-engine.ts
│       ├── openclaw.ts
│       ├── routines.ts
│       ├── vocabulary.ts    # Simple/Pro mode term mapping
│       └── ...
├── scripts/
└── bruno/                   # API testing collection
```

---

## Database Schema

Full schema in `src/db/schema.ts`. Key tables:

| Table | Purpose |
|-------|---------|
| `companies` | Multi-tenant orgs with mission, settings |
| `company_members` | User-company membership with roles |
| `users` | Auth (email/password + GitHub) with invite flow |
| `agents` | Agent registry with adapters, visibility, runtime config |
| `tasks` | Task lifecycle with PR tracking, images, comments |
| `projects` | Project grouping with goal linking |
| `goals` | Hierarchical goal trees per company |
| `skills` | Agent capabilities (custom, ClawHub, GitHub) |
| `agent_skills` | Many-to-many agent-skill assignments |
| `team_blueprints` | Pre-built team templates |
| `inbox_messages` | Agent-to-human/agent communication with actions |
| `agent_access_grants` | Per-user agent permissions |
| `agent_budgets` | Per-agent monthly spending limits |
| `cost_events` | Token/cost tracking per agent per task |
| `org_chart_nodes` | Org chart hierarchy with delegation flags |
| `approval_gates` | Gate types requiring human approval |
| `approval_requests` | Pending/resolved approval decisions |
| `config_versions` | Versioned config snapshots with rollback |
| `audit_log` | Immutable append-only audit trail |
| `heartbeat_schedules` | Cron-based agent wake schedules |
| `heartbeat_executions` | Heartbeat run logs |
| `escalation_paths` | Trigger-based escalation routing |
| `routine_templates` | Recurring task templates on schedules |
| `activity_log` | General agent activity feed |
| `task_comments` | Per-task discussion |
| `time_entries` | Human time tracking per task |
| `agent_heartbeats` | Live agent status/heartbeat data |
| `cron_jobs` | Scheduled job tracking |
| `node_status` | OpenClaw node health |
| `docs` | Categorized documents with tags |
| `workspace_files` | Synced workspace file trees |

---

## Development

### Quick Start (Zero Config)

```bash
pnpm install
pnpm dev
# Opens http://localhost:3000 with embedded PGlite — no DB setup needed
```

### With External Postgres

```bash
cp .env.example .env.local
# Set DATABASE_URL in .env.local
pnpm install
pnpm db:push
pnpm dev
```

### Docker

```bash
docker compose up
```

### Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:push` | Push schema to DB |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | Seed database |

---

## Completed Phases

### Phase 0: Foundation ✅
- Rebranded from Mission Control to CrewCmd
- Fresh git repo, cleaned Axislabs-specific configs
- package.json, README, .env.example all updated
- All "Mission Control" references renamed
- GitHub repo created at axislabs-dev/crewcmd
- Builds and runs from clean clone

### Phase 1: Multi-Tenancy & Goal Hierarchy ✅
- Companies table with mission, settings, member roles
- Company-scoped data across all entities
- Goal hierarchy (company mission → project goals → agent goals → tasks)
- Company switcher in sidebar

### Phase 2: Budget & Cost Control ✅
- Agent budgets with monthly limits and alert thresholds
- Cost event tracking (provider, model, tokens, USD)
- Budget enforcement with auto-pause
- Budgets dashboard page

### Phase 3: Governance & Org Chart ✅
- Interactive org chart with delegation flags
- Approval gates (agent hire, strategy change, budget increase, config change, task escalation)
- Approval request workflow (pending → approved/rejected/expired)
- Config versioning with snapshots
- Immutable audit log

### Phase 4: Heartbeat Scheduling & Autonomy ✅
- Configurable heartbeat schedules per agent (cron expressions, timezones)
- Heartbeat execution engine with status tracking
- Escalation paths (blocked tasks, budget exceeded, heartbeat failed, approval timeout, agent offline)
- Routine templates for recurring task creation
- Automations page (renamed from /routines)

### Post-Phase Features (shipped beyond original roadmap)

- **Agent Execution Engine** — Runtime with adapter-specific executors, control panel UI, terminal output viewer
- **Multi-Adapter Support** — OpenClaw Gateway, OpenRouter, HTTP, custom. Full CRUD and onboarding wizard
- **Team Blueprints** — 8 pre-built templates (dev squad, marketing, support, solo founder, etc.) with one-click deployment
- **Skills System** — Skills marketplace browsing (ClawHub, skills.sh, GitHub), agent-skill attachments, custom skills
- **Agent Inbox** — Centralized communication hub with priority tiers, action buttons, read/actioned/snoozed/dismissed states
- **Access Tiers** — Private/assigned/team agent visibility with per-user permission grants
- **Simple/Pro Mode** — Toggle technical complexity. Vocabulary simplification for non-technical users
- **PGlite Zero-Config** — Embedded Postgres for instant local dev, no DB setup
- **Docker Support** — Dockerfile + docker-compose.yml
- **Email/Password Auth** — Added alongside GitHub OAuth
- **UI Polish** — Slim sidebar (17 → 8 items), readability improvements, dark/light themes, welcome hero

---

## Roadmap (What's Next)

### Phase 5: Plugin System & Templates
- Plugin API (register routes, UI panels, agent capabilities)
- Built-in plugins: knowledge base connector, enhanced GitHub integration, Slack notifications
- Company template export/import (full org + agents + goals + skills)
- Template marketplace (community-shared blueprints)
- Runtime skill discovery (agents load skills on demand)

### Phase 6: SaaS & Cloud
- Managed hosting on Vercel with Neon/Supabase
- Stripe billing (free tier, pro, enterprise)
- Custom domains per company
- SSO (Google, GitHub, SAML)
- Mobile-responsive dashboard

### Ongoing
- Agent execution polish: better terminal UX, streaming output, error recovery
- WebSocket/SSE for live updates (replace polling)
- Enhanced budget dashboards with charts and forecasting
- Deeper OpenClaw integration (live session control, agent spawning from UI)
- GitHub webhook enhancements (auto-create tasks from issues, PR review tracking)

---

## Competitive Positioning

### vs Paperclip
- **Paperclip** = orchestration-first, "zero-human companies" framing, embedded PG, plugin ecosystem
- **CrewCmd** = operations-first, hybrid human+agent teams, live OpenClaw integration, GitHub-native workflow, voice interface
- **Our edge:** Built BY an agent team FOR agent teams. We dogfood everything. Paperclip is a tool for people to set up agent companies. CrewCmd is the tool agent companies actually use to operate.

### vs Linear/Asana/Trello
- Human task managers bolting on AI features after the fact
- CrewCmd is agent-native: heartbeats, budgets, delegation, governance are first-class

### vs OpenClaw alone
- OpenClaw is the employee. CrewCmd is the office.

---

## Code Conventions

- TypeScript strict mode
- Functional components only
- Server components by default, `"use client"` only when needed
- Atomic commits (one logical change per commit)
- No `any` types unless absolutely unavoidable (and commented why)
- Tables: snake_case plural (e.g., `cost_events`)
- API routes: `/api/[resource]` RESTful
- Components: PascalCase files in `/src/components/`
- Pages: kebab-case directories in `/src/app/`

---

## API Auth

- **GET endpoints** — Public (no auth required)
- **Mutations (POST/PATCH/DELETE)** — Require `Authorization: Bearer <HEARTBEAT_SECRET>` header or valid NextAuth session
- Auth logic in `src/lib/require-auth.ts`

---

## Known Issues

- **README says MIT but LICENSE is BSL 1.1** — README footer needs updating to match the actual BSL license
- Real-time updates still use polling (WebSocket/SSE not yet implemented)
- Agent execution is functional but terminal UX needs polish

---

## For Agents Working on This Project

### Getting Started

1. **Read this file first** — It's the source of truth for architecture, phases, and current state.
2. **Read CONTRIBUTING.md** — Community guidelines and development workflow.
3. **Clone and set up locally:**
   ```bash
   git clone https://github.com/axislabs-dev/crewcmd.git
   cd crewcmd
   pnpm install
   pnpm dev
   ```
4. **Verify you can build:**
   ```bash
   pnpm build
   pnpm lint
   ```

### Code Quality Rules

- **TypeScript strict mode always.** No `any` types (comment why if unavoidable).
- **No hardcoded user IDs, team names, or environment-specific values.** Use env vars or config tables.
- **Every change must build and lint.** `pnpm build && pnpm lint` before pushing.
- **Atomic commits.** One logical change per commit. Use conventional commit format.
  ```
  feat: add agent execution controls to dashboard
  fix: resolve PGlite schema migration race condition
  refactor: consolidate org chart and team pages
  docs: update API authentication section
  ```
- **Preserve API contracts.** Don't break existing endpoints. Versioning over breaking changes.
- **Test both database paths:** PGlite (default local) AND external Postgres (Neon). Both must work.

### Database Changes

When modifying `src/db/schema.ts`:

1. Make your change to the table definition
2. Run `pnpm db:generate` to create a migration
3. Test locally with `pnpm dev` (PGlite)
4. Test against external Postgres if possible
5. Include the migration files in your commit
6. Add a note in CHANGELOG.md under `[Unreleased]`

Example:
```bash
# Edit schema
vim src/db/schema.ts

# Generate migration
pnpm db:generate

# Test
pnpm dev

# Commit both changes
git add src/db/schema.ts drizzle/0001_*.sql
git commit -m "feat: add agent execution status tracking"
```

### API Endpoint Rules

**GET endpoints:**
- Public (no auth required)
- Idempotent
- Cache-friendly

**POST/PATCH/DELETE endpoints:**
- Require `Authorization: Bearer <HEARTBEAT_SECRET>` header OR valid NextAuth session
- Use `requireAuth()` middleware from `src/lib/require-auth.ts`
- Return 401 for auth failures, 400 for invalid body, 404 for not found
- Example:
  ```typescript
  import { requireAuth } from "@/lib/require-auth";
  
  export async function PATCH(req: NextRequest) {
    const authError = await requireAuth(req);
    if (authError) return authError;
    
    // Your logic here
  }
  ```

### Common Pitfalls (Don't Do These)

- ❌ Hardcode "roger" as a user ID (use `admin` or env var)
- ❌ Add Slack notifications without making channel ID configurable
- ❌ Reference internal projects (Thoroughbreds.ai, ClutchCut internal names)
- ❌ Skip testing against both PGlite and external Postgres
- ❌ Force push to main (never acceptable)
- ❌ Commit `.env` or `.env.local` files
- ❌ Leak API keys/tokens in client-side code
- ❌ Break existing task lifecycle or agent status model

### PR Checklist

Before opening a PR:

- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] Code follows TypeScript strict mode
- [ ] No hardcoded personal/internal references
- [ ] API endpoints have proper auth guards
- [ ] Database migrations generated (if schema changed)
- [ ] Tested with both PGlite and external Postgres
- [ ] Commit messages are conventional and atomic
- [ ] CHANGELOG.md updated (if applicable)
- [ ] No `.env` or secrets in commit history

### Testing Against External Postgres

```bash
# Get a test DATABASE_URL (Neon free tier, Supabase, local PG)
cp .env.example .env.local

# Edit .env.local with your DATABASE_URL
DATABASE_URL="postgresql://user:pass@host.neon.tech/crewcmd?sslmode=require"

# Push schema
pnpm db:push

# Run dev server
pnpm dev

# The app will use external Postgres instead of PGlite
```

### Feature Scope & Phases

**Don't implement features from future phases.** Stick to the current phase or fix bugs/tech debt.

- Phase 0–4 are complete. Code should reflect this.
- Phase 5 (plugin system) is next — don't start it yet.
- If you think Phase 5 needs tweaks, open an issue discussion first.

### Long-Running Tasks

For multi-day features (e.g., a full new subsystem):

1. Open a GitHub issue first to discuss
2. Create a feature branch: `feature/your-feature-name`
3. Commit regularly with clear messages
4. When ready, open a draft PR with progress notes
5. Ask for feedback early and often

### Questions & Help

- Check CLAUDE.md and README.md first
- Check closed GitHub issues for similar discussions
- Open an issue to ask before starting large work
- Review existing code in the relevant section (e.g., look at other API routes before writing yours)

### Shipping vs Perfection

CrewCmd is a real operating platform. **Shipping working code beats waiting for perfect code.** If you're stuck on polish, ship with a "FIXME" comment and open an issue for the improvement. Make it visible in CHANGELOG.md and CI can catch real bugs.

### After Your PR is Merged

- The maintainers may run it against the live instance
- Monitor for any issues reported
- Be ready to hotfix if needed
- Update CHANGELOG.md with the shipped version when it's released
