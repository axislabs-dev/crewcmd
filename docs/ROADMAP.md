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

## Technical Debt

- Pre-existing type errors in `chat/page.tsx` (unrelated to design overhaul)
- Next.js middleware deprecation warning (use `proxy` instead)
- Turbopack NFT tracing warning from `openclaw-config-parser.ts`
- PGlite migration for production-scale deployments

---

*Last updated: 2026-04-10 by Neo*
