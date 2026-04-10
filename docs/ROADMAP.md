# CrewCmd Roadmap

> CrewCmd is meant to be THE only hybrid agent/human project management layer in the world for multi-agent systems of the future. Small teams co-exist with agents that act like colleagues — with full audit trail, tasks, policies, RBAC, governance — in a team-based environment where agents can be shared, private, and managed like real team members.

---

## Guiding Principles

- **Agents are colleagues, not tools.** They have identities, performance metrics, permissions, and accountability.
- **Governance is the moat.** Audit trail, policy enforcement, and cost control are what make this enterprise-ready.
- **Hybrid means hybrid.** Human and agent workflows are first-class and equal on the same platform.
- **Revenue-ready.** Every feature should make CrewCmd more sellable.

---

## Phase 1: Foundation (NOW — April 2026)

*Status: In progress*

### 1.1 Skill Sync with OpenClaw
**Goal:** Skills managed in CrewCmd auto-push to OpenClaw runtime. Agents run with CrewCmd context built-in.

**Tasks:**
- [x] Core sync library (`syncSkillToOpenClaw`) — PR #79
- [ ] API: `POST /api/skills/:skillId/sync` — single skill sync
- [ ] API: `POST /api/agents/:agentId/sync-all-skills` — bulk sync per agent
- [ ] API: `GET /api/skills/sync-status` — sync health across all agents
- [ ] UI: Sync button in skills page + status indicators
- [ ] Scheduled sync via cron (e.g., every 5min for active agents)

**Blockers:** None

### 1.2 Chat Thread Governance
**Goal:** Every agent has persistent, scoped conversation history visible in CrewCmd.

**Tasks:**
- [x] Fix per-agent chat thread loading from OpenClaw gateway — PR #78
- [ ] Export conversation threads as audit log entries
- [ ] Thread search and filtering by agent, date, topic
- [ ] Pin important threads for review

### 1.3 Agent Identity & Avatars
**Goal:** Agents have unique, customizable avatars. User profiles editable system-wide.

**Tasks:**
- [ ] Avatar upload/crop for agents (stored in DB or S3-compatible)
- [ ] Avatar display in chat, team page, task board, notifications
- [ ] User avatar system (editable in user settings)
- [ ] Import avatars from OpenClaw on first connect
- [ ] Default avatar generation (emoji + initials)

### 1.4 Task Board Assignees
**Goal:** Tasks can be assigned to any team member (human or agent).

**Tasks:**
- [ ] Agent selector dropdown in task creation/edit
- [ ] Task card shows assignee avatar + name
- [ ] Agent tasks view (filter board by agent)
- [ ] Task assignment notifications

---

## Phase 2: Visibility (May 2026)

### 2.1 Audit Trail
**Goal:** Complete governance log of everything that happens in the system.

**Tasks:**
- [ ] Audit log data model (who, what, when, why, outcome)
- [ ] Auto-capture: skill changes, agent config changes, permission changes
- [ ] Auto-capture: agent-initiated actions outside of tasks
- [ ] Auto-capture: budget threshold crossings
- [ ] Audit log UI (filterable timeline, export)
- [ ] Decision log: agent X chose strategy Y because Z
- [ ] Policy violation alerts

### 2.2 Agent Performance Metrics
**Goal:** Measure and compare agent ROI — nobody else does this.

**Tasks:**
- [ ] Task completion rate per agent per week
- [ ] Average response time, first-response time
- [ ] Cost per task, cost trends over time
- [ ] Error rate, retry rate
- [ ] Dashboard: agent scorecards with trends
- [ ] Weekly digest: top performers, underperformers

### 2.3 Human Experience
**Goal:** Make it feel like a real team management platform.

**Tasks:**
- [ ] Activity feed (what changed while you were away)
- [ ] @mentions across chat, tasks, comments
- [ ] Comment threads on tasks
- [ ] Notification preferences (email, in-app, webhook)
- [ ] "What's happening today" daily digest

---

## Phase 3: Control (June 2026)

### 3.1 Policy Engine
**Goal:** Enforce rules, not just observe them.

**Tasks:**
- [ ] Budget enforcement: auto-stop agents when cap reached
- [ ] Approval gates: require human sign-off for certain actions
- [ ] Role-based tool access: restrict dangerous tools by agent level
- [ ] Compliance rules: auto-log all external API calls
- [ ] Custom policy rules (if X, then require approval)
- [ ] Policy violation dashboard

### 3.2 Skill Marketplace
**Goal:** Reusable, versioned skills that can be shared across teams.

**Tasks:**
- [ ] Skill versioning + changelog
- [ ] Skill health monitoring (API failures, rate limits)
- [ ] Browse/preview skills before install
- [ ] Skill sharing between companies (opt-in)
- [ ] Community skill contributions

### 3.3 Agent Templates & Cloning
**Goal:** One-click agent configuration reuse.

**Tasks:**
- [ ] Save agent config as template
- [ ] Clone agent with all skills, permissions, policies
- [ ] Template library (pre-built agent types)
- [ ] Cross-team template sharing

---

## Phase 4: Scale (July+ 2026)

### 4.1 Multi-Runtime Management
**Goal:** Manage agents across multiple OpenClaw instances, cloud providers, etc.

**Tasks:**
- [ ] Runtime provisioning (deploy new OpenClaw instance from CrewCmd)
- [ ] Agent migration between runtimes
- [ ] Runtime health dashboard
- [ ] Cross-runtime skill sync

### 4.2 Agent-to-Agent Visibility
**Goal:** See and audit inter-agent communication.

**Tasks:**
- [ ] Inter-agent message routing through CrewCmd
- [ ] Escalation patterns (when does Agent A hand off to Agent B)
- [ ] Cross-agent task handoffs with audit trail
- [ ] Message queue between agents

### 4.3 Sharing & Multi-Tenancy
**Goal:** Shared agents, private agents, cross-company collaboration.

**Tasks:**
- [ ] Shared agents (multiple humans interact)
- [ ] Private agents (single owner only)
- [ ] Cross-company agent marketplace
- [ ] Role-based agent visibility controls

---

## Current Sprint (April 10-14)

| Task | Assignee | Status |
|------|----------|--------|
| Sync API endpoints (single + bulk) | Cipher | In Progress |
| Sync UI + status indicators | Forge | Backlog |
| Avatars (agent + user) | Forge | Backlog |
| Activity feed + @mentions | Blitz | Backlog |
| Audit log data model | Cipher | Backlog |
| Performance metrics dashboard | Forge | Backlog |
| Budget enforcement | Cipher | Backlog |

---

## Engineering Foundations

> These items make the codebase contributor-friendly, testable, and maintainable as the project scales. Many are excellent first contributions.

### Testing

CrewCmd currently has minimal test coverage. The goal is to build a safety net that lets contributors ship with confidence.

**Priority test targets (ordered by risk):**

| Area | What to test | Why it matters |
|------|-------------|----------------|
| Skill invoke pipeline | `service-skills.ts` → handler → secret resolution | Core value prop; breaks silently |
| Agent CRUD API | `POST/GET/PATCH /api/agents` | Most-used endpoints |
| Skills CRUD + assignment | `POST /api/skills`, agent skill attach/detach | Skill engine is the moat |
| Auth flow | Signup, login, session, company membership | Security boundary |
| Governance | Approval gate checks, audit log writes | Trust layer |
| Heartbeat engine | Cron parsing, schedule calculation, execution lifecycle | Agents depend on this to wake up |
| Skill config form | Schema parsing, validation, secret ref detection | UI correctness |

**Testing conventions:**
- Framework: Vitest (already configured)
- DB: Use PGlite in tests — no external database needed
- Location: Co-locate tests with source (`foo.test.ts` next to `foo.ts`)
- Coverage goal: Critical paths first, not percentage targets
- Run: `pnpm test` (must pass in CI before merge)

**Good first issues for testing:**
- Add happy-path test for `POST /api/skills` (create a skill, verify it's returned by GET)
- Add test for `resolveAdapterFromSkills` with mock agent skills
- Add test for `calculateNextExecution` cron parser edge cases
- Add test for `checkApprovalRequired` governance check
- Add integration test for skill invoke end-to-end (evercontent handler with mocked HTTP)

### Schema Organization

The schema (`src/db/schema.ts`, 815 lines, 30+ tables) should be split by domain for readability:

| File | Tables |
|------|--------|
| `schema/agents.ts` | agents, agentHeartbeats, agentSkills, agentBudgets |
| `schema/tasks.ts` | tasks, taskComments, timeEntries, projects |
| `schema/skills.ts` | skills, agentSkills, serviceSecrets |
| `schema/governance.ts` | approvalGates, approvalRequests, auditLog, configVersions, escalationPaths |
| `schema/heartbeats.ts` | heartbeatSchedules, heartbeatExecutions |
| `schema/company.ts` | companies, companyMembers, companyProviderKeys, companyRuntimes |
| `schema/users.ts` | users |
| `schema/content.ts` | docs, workspaceFiles, inboxMessages |
| `schema/index.ts` | Re-exports everything (no breaking changes) |

### Architecture Decision Records (ADRs)

Key decisions that need to be documented so contributors understand *why*, not just *what*:

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | Multi-tenant by company — companyId on everything, personal workspaces are single-member companies | Needs writing |
| ADR-002 | Adapter pattern for agent execution — agents are runtime-agnostic, skills map to adapters | Needs writing |
| ADR-003 | Skill system — three sources (built-in, system, marketplace), service-skill vs CLI-skill, config resolution | Needs writing |
| ADR-004 | Heartbeat model — agents wake/check/exit vs persistent processes | Needs writing |
| ADR-005 | OpenClaw gateway as default runtime — WebSocket RPC with Ed25519 device auth | Needs writing |
| ADR-006 | Two-tier skill config — company-level defaults + per-agent overrides | Needs design |
| ADR-007 | Governance as middleware — approval checks before actions, not just audit after | Needs design |

Location: `docs/architecture/decisions/` — one file per ADR, short (context → decision → consequences).

### API Validation

API routes currently do minimal input validation. Adding schema validation at the boundary prevents bad data and gives contributors clear contracts.

**Approach:** Zod schemas co-located with route handlers. Validate request body at the top of each POST/PATCH handler.

**Good first issues:**
- Add Zod validation to `POST /api/skills` (name, slug required; metadata shape)
- Add Zod validation to `POST /api/agents` (callsign, name, title required)
- Add Zod validation to `POST /api/tasks` (title required; status/priority must be valid enum)
- Add Zod validation to `POST /api/service-secrets` (name, value required)

### Lib Organization

`src/lib/` has 40+ files at the top level. Group by domain incrementally:

```
src/lib/
├── agents/        # resolve-agent, agent-access, agent-runtime, delegation
├── skills/        # built-in, evercontent, service-skills, skill-config-form
├── governance/    # governance, escalation, budget
├── gateway/       # gateway-client, openclaw, openclaw-config-parser
├── chat/          # chat-store, chat-tools, chat-pubsub, chat-system-prompt
├── auth/          # auth, require-auth, heartbeat-auth
└── utils.ts       # General utilities
```

This is a mechanical refactor — update imports, no logic changes. Can be done one domain at a time.

---

## Technical Debt

- Pre-existing type errors in `chat/page.tsx` (unrelated to design overhaul)
- Next.js middleware deprecation warning (use `proxy` instead)
- Turbopack NFT tracing warning from `openclaw-config-parser.ts`
- PGlite migration for production-scale deployments

---

*Last updated: 2026-04-10*
