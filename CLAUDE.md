# CrewCmd — CLAUDE.md

> Open-source agent crew orchestration. Born from Mission Control, inspired by Paperclip.

## Vision

CrewCmd is a self-hosted, open-source SaaS for orchestrating teams of AI agents across projects and organizations. Think of it as "the company layer" for your AI workforce: org charts, task management, budgets, governance, and goal alignment in one dashboard.

**Tagline:** _Your crew. Your command._

**Origin:** This repo started as Axislabs' internal Mission Control (task board + agent coordination for OpenClaw agents). The goal is to uplift it into a polished, multi-tenant open-source product that competes with Paperclip while staying true to our operational roots.

---

## Migration Plan: Mission Control → CrewCmd

### What We're Starting With (Mission Control)

The existing codebase provides a solid operational foundation:

- **Stack:** Next.js 16 + React 19 + Tailwind CSS + Drizzle ORM + Neon (Postgres)
- **Auth:** NextAuth with GitHub OAuth + invite/accept flow + role-based access (super_admin, admin, viewer)
- **Task system:** Full lifecycle (backlog → inbox → queued → in_progress → review → done/failed/blocked), priority levels, PR tracking, comments, images, time entries
- **Agent management:** Agent registry with callsigns, status tracking, heartbeats, soul content
- **Project management:** Projects with owner agents, documents, context tracking
- **Activity logging:** Audit trail of agent actions
- **Integrations:** OpenClaw gateway (agents, nodes, health), GitHub webhooks, cron jobs, workspace file sync
- **UI pages:** Dashboard, Tasks (board + table), Agents (list + detail), Projects, Docs, Chat (with voice), Team, Schedules, Office, Settings
- **API:** RESTful routes for all entities, bearer token auth on mutations

### What Paperclip Has That We Don't (Yet)

Key features from Paperclip (39K stars, MIT, TypeScript) to adopt:

1. **Goal Hierarchy** — Company mission → Project goals → Agent goals → Tasks. Every task traces back to the "why."
2. **Org Chart as First-Class** — Reporting lines, delegation flows, hierarchical heartbeats (manager agents delegate to reports).
3. **Budget/Cost Control** — Per-agent monthly budgets, token tracking, spend dashboards, auto-throttle when budget exceeded.
4. **Multi-Company Isolation** — One deployment, many companies. Complete data isolation per company.
5. **Governance Model** — Board-level controls: approve hires, override strategy, pause/terminate agents, config versioning with rollback.
6. **Heartbeat Scheduling** — Agents wake on configurable schedules (every 4h, 8h, 12h), check work, act. Not just status pings.
7. **Ticket-Based Communication** — Structured conversations per task with full tool-call tracing.
8. **Company Templates** — Export/import entire org structures, agent configs, and skills.
9. **Plugin System** — Drop-in extensions for knowledge bases, custom tracing, queues, etc.
10. **Skills Manager** — Agents discover context they need at runtime.

### What We Have That Paperclip Doesn't

Our operational advantages to preserve:

1. **Live OpenClaw Integration** — Direct gateway API for real-time agent/node/session status.
2. **GitHub Webhook Pipeline** — PR status, review cycles, branch tracking per task.
3. **Voice Interface** — Chat with STT/TTS, voice recorder, waveform visualizer.
4. **Time Tracking** — Human time entries per task (useful for hybrid human+agent teams).
5. **Workspace File Sync** — Push/pull workspace files through the dashboard.
6. **Cron Management** — Schedule dashboard with push-based status updates.
7. **Document System** — Categorized docs with tags, linked to projects/tasks.

---

## Phase 0: Foundation (Current Phase)

**Goal:** Rebrand, clean up, establish the project structure for open-source development.

### Checklist

- [x] Copy mission-control to ~/Developer/axislabs/crewcmd
- [x] Initialize fresh git repo
- [x] Remove environment files and Axislabs-specific configs
- [x] Write CLAUDE.md (this file)
- [ ] Update package.json (name: crewcmd, description, etc.)
- [ ] Update README.md with CrewCmd branding
- [ ] Rename all "Mission Control" references in code to "CrewCmd"
- [ ] Add .env.example with all required vars documented
- [ ] Create GitHub repo under axislabs-dev org
- [ ] Initial commit + push
- [ ] Verify it builds and runs locally with fresh setup

### Phase 0 Constraints
- No new features. Just rename, rebrand, clean, document.
- Preserve all existing functionality.
- Make sure `pnpm install && pnpm dev` works from a clean clone.

---

## Phase 1: Multi-Tenancy & Goal Hierarchy

**Goal:** Add the "company" layer. Multiple orgs, goal trees, proper data isolation.

### Schema Changes
- Add `companies` table (name, mission, settings, created_by)
- Add `company_id` FK to: tasks, projects, agents, activity_log, docs, cron_jobs
- Add `goals` table (company_id, parent_goal_id, title, description, status, owner_agent_id)
- Link projects → goals, tasks → goals (every task traces to mission)
- Add `company_members` join table (user_id, company_id, role)

### UI Changes
- Company switcher in sidebar
- Company settings page (mission, logo, members)
- Goal tree view (mission → project goals → agent goals → tasks)
- Onboarding flow for new company creation

### API Changes
- All routes scoped by company_id (middleware)
- Company CRUD endpoints
- Goal CRUD endpoints

---

## Phase 2: Budget & Cost Control

**Goal:** Track and control agent spend per company.

### Schema Changes
- Add `agent_budgets` table (agent_id, company_id, monthly_limit, current_spend, period_start)
- Add `cost_events` table (agent_id, task_id, provider, model, tokens_in, tokens_out, cost_usd, timestamp)
- Add budget fields to agent config

### Features
- Cost dashboard (per agent, per project, per company)
- Budget enforcement (auto-pause agent when budget exceeded)
- Token tracking integration (OpenClaw usage API, or manual reporting)
- Budget alerts (Slack/email when 80%, 100% threshold)

---

## Phase 3: Governance & Org Chart

**Goal:** Formalize agent hierarchy, approval gates, and audit controls.

### Features
- Interactive org chart builder (drag-drop agent hierarchy)
- Delegation flow (manager agents can assign to reports)
- Approval gates (human approval required for: new agent hires, strategy changes, budget increases)
- Config versioning (every org/agent config change is revisioned)
- Rollback capability (revert to previous config version)
- Immutable audit log (append-only, no edits/deletions)

---

## Phase 4: Heartbeat Scheduling & Autonomy

**Goal:** Agents wake on schedules, discover work, act autonomously within governance bounds.

### Features
- Configurable heartbeat schedules per agent (cron expression)
- Heartbeat execution engine (wake agent → check tasks → act → report)
- Cross-team delegation (agent can request work from agents in other teams)
- Escalation paths (blocked task → escalate to manager agent → escalate to human)
- Routine templates (recurring tasks that auto-create on schedule)

---

## Phase 5: Plugin System & Templates

**Goal:** Make CrewCmd extensible and shareable.

### Features
- Plugin API (register routes, UI panels, agent capabilities)
- Built-in plugins: knowledge base, GitHub integration, Slack notifications
- Company templates (export/import org + agents + goals + skills)
- Template marketplace (community-shared company blueprints)
- Skills manager (agents discover and load skills at runtime)

---

## Phase 6: SaaS & Cloud

**Goal:** Hosted version for teams who don't want to self-host.

### Features
- Vercel deployment with managed Postgres
- Stripe billing (free tier, pro, enterprise)
- Custom domains per company
- SSO (Google, GitHub, SAML)
- Mobile-responsive dashboard (or native app)

---

## Technical Decisions

### Stack (Inherited + Planned)
| Layer | Current | Target |
|-------|---------|--------|
| Framework | Next.js 16 (App Router) | Keep |
| UI | React 19 + Tailwind | Keep, add shadcn/ui components |
| ORM | Drizzle | Keep |
| Database | Neon (Postgres) | Keep (support self-hosted PG too) |
| Auth | NextAuth (GitHub OAuth) | Keep, add email/password + SSO |
| Hosting | Vercel | Keep as primary, support self-host |
| Real-time | Polling | Add WebSocket/SSE for live updates |

### Naming Conventions
- **Tables:** snake_case plural (e.g., `cost_events`)
- **API routes:** `/api/[resource]` RESTful
- **Components:** PascalCase files in `/src/components/`
- **Pages:** kebab-case directories in `/src/app/`

### Code Style
- TypeScript strict mode
- Functional components only
- Server components by default, `"use client"` only when needed
- Atomic commits (one logical change per commit)
- No `any` types unless absolutely unavoidable (and commented why)

---

## Competitive Positioning

### vs Paperclip
- **Paperclip** = orchestration-first, "zero-human companies" framing, embedded PG, plugin ecosystem
- **CrewCmd** = operations-first, hybrid human+agent teams, live OpenClaw integration, GitHub-native workflow, voice interface
- **Our edge:** We're built BY an agent team FOR agent teams. We dogfood everything. Paperclip is a tool for people to set up agent companies. CrewCmd is the tool that agent companies actually use to operate.

### vs Linear/Asana/Trello
- Those are human task managers bolting on AI features
- CrewCmd is agent-native: heartbeats, budgets, delegation, governance are first-class

### vs OpenClaw alone
- OpenClaw is the employee. CrewCmd is the office.

---

## Repository Structure

```
crewcmd/
├── CLAUDE.md           # This file — project plan and agent instructions
├── README.md           # Public-facing docs
├── package.json
├── drizzle.config.ts
├── drizzle/            # DB migrations
├── src/
│   ├── app/            # Next.js App Router pages + API routes
│   │   ├── api/        # REST API endpoints
│   │   ├── dashboard/  # Main dashboard
│   │   ├── agents/     # Agent management
│   │   ├── tasks/      # Task board + table
│   │   ├── projects/   # Project management
│   │   ├── chat/       # Voice/text chat
│   │   └── ...
│   ├── components/     # React components
│   ├── db/             # Schema + seed
│   ├── lib/            # Utilities, auth, integrations
│   └── middleware.ts   # Auth + routing middleware
├── scripts/            # Operational scripts
└── bruno/              # API testing collection
```

---

## For Agents Working on This Project

1. **Read this file first.** It's the source of truth for what CrewCmd is and where it's going.
2. **Phase 0 is about cleanliness, not features.** Don't add anything new yet.
3. **Every change must build.** Run `pnpm build` before committing.
4. **Atomic commits.** One logical change per commit. Clear commit messages.
5. **Don't touch the schema yet.** Phase 0 is rename/rebrand only. Schema changes start in Phase 1.
6. **Preserve all existing API contracts.** Mission Control API consumers (crons, OpenClaw heartbeats) must keep working during transition.
