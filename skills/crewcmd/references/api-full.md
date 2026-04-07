# CrewCmd API Reference

All endpoints require authentication (session cookie or `Authorization: Bearer <token>`) unless noted otherwise.

Base URL: `http://localhost:3000/api` (or your deployment URL)

---

## Health

### `GET /api/health`

Returns service health status. **No auth required.**

**Response:** `{ "status": "ok", "database": "connected" | "disconnected", "timestamp": "..." }`

---

## Agents

### `GET /api/agents`

List all agents for the current company.

**Query params:** `companyId` (optional, falls back to cookie)

**Response:** Array of agent objects with callsign, role, status, model, skills, etc.

### `GET /api/agents/:callsign`

Get a single agent by callsign.

### `PATCH /api/agents/:callsign`

Update agent configuration (model, system prompt, skills, etc.).

### `POST /api/agents/:callsign/start`

Start an agent (connect to runtime).

### `POST /api/agents/:callsign/stop`

Stop a running agent.

### `POST /api/agents/:callsign/restart`

Restart an agent.

### `GET /api/agents/:callsign/status`

Get agent runtime status (online, offline, working).

### `GET /api/agents/:callsign/output`

Get recent agent output/logs.

### `GET /api/agents/:callsign/output/stream`

SSE stream of live agent output.

### `POST /api/agents/:callsign/task`

Assign a task to an agent.

**Body:** `{ "taskId": "..." }` or `{ "message": "..." }`

### `PATCH /api/agents/:callsign/visibility`

Set agent visibility (private, team, company).

**Body:** `{ "visibility": "private" | "team" | "company" }`

### `GET /api/agents/:callsign/skills`

List skills assigned to an agent.

### `POST /api/agents/:callsign/skills`

Assign a skill to an agent.

### `DELETE /api/agents/:callsign/skills/:skillId`

Remove a skill from an agent.

---

## Chat

### `POST /api/chat`

Send a message to an agent and receive a streaming response (SSE).

**Body:**
```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "agent": "neo",
  "companyId": "..."
}
```

**Response:** Server-Sent Events stream with `data:` lines:
- `{ "type": "meta", "messageId": "...", "role": "user" }` — server-confirmed user message ID
- `{ "choices": [{ "delta": { "content": "..." } }] }` — streaming content chunks
- `{ "type": "meta", "messageId": "...", "role": "assistant" }` — server-confirmed assistant message ID
- `data: [DONE]` — stream complete

### `GET /api/chat/sessions?companyId=...&agentId=...`

List chat sessions. `agentId` is optional.

**Response:** `{ "sessions": [{ "id", "agentId", "companyId", "title", "updatedAt" }] }`

### `POST /api/chat/sessions`

Create a new chat session.

**Body:** `{ "agentId": "neo", "companyId": "..." }`

### `GET /api/chat/messages?sessionId=...&limit=100`

Fetch messages for a session (oldest first, max 500).

**Response:** `{ "messages": [{ "id", "role", "content", "createdAt", "metadata" }] }`

### `POST /api/chat/messages`

Persist a message directly (used for external integrations).

**Body (option A):** `{ "sessionId": "...", "role": "user", "content": "..." }`

**Body (option B):** `{ "agentId": "neo", "companyId": "...", "role": "user", "content": "..." }` — auto-resolves or creates session.

### `GET /api/chat/events?companyId=...&since=<ISO>`

SSE endpoint for real-time chat events across all agents.

**Events:** `{ "type": "message", "id", "sessionId", "agentId", "role", "content", "createdAt" }`

Sends heartbeat pings every 30s. Reconnects automatically on client side.

### `GET /api/chat/history?sessionKey=...&limit=50`

Fetch conversation history from the OpenClaw Gateway (raw gateway sessions, not DB).

### `POST /api/chat/create-task`

Create a task from a chat message.

### `POST /api/chat/upload`

Upload a file attachment for chat.

---

## Tasks

### `GET /api/tasks`

List tasks with optional filters.

**Query params:** `status`, `agentId`, `humanAssignee`, `projectId`, `priority`, `unassigned`, `excludeHumanAssignee`, `limit`, `offset`

### `POST /api/tasks`

Create a task.

**Body:** `{ "title": "...", "description": "...", "status": "inbox", "priority": "medium", "assignedAgentId": "...", "projectId": "..." }`

### `GET /api/tasks/:id`

Get a single task.

### `PATCH /api/tasks/:id`

Update a task (status, assignee, priority, etc.).

### `DELETE /api/tasks/:id`

Delete a task.

### `GET /api/tasks/:id/comments`

List comments on a task.

### `POST /api/tasks/:id/comments`

Add a comment to a task.

### `GET /api/tasks/:id/time-entries`

List time entries for a task.

### `POST /api/tasks/:id/time-entries`

Log time against a task.

### `POST /api/tasks/:id/images`

Upload an image to a task.

### `GET /api/tasks/:id/images/:index`

Get a task image by index.

---

## Projects

### `GET /api/projects`

List all projects.

### `POST /api/projects`

Create a project.

**Body:** `{ "name": "...", "description": "...", "status": "active" }`

### `GET /api/projects/:id`

Get a single project.

### `PATCH /api/projects/:id`

Update a project.

### `DELETE /api/projects/:id`

Delete a project.

---

## Inbox

### `GET /api/inbox`

List inbox items (agent decisions, blockers, completions).

**Query params:** `priority`, `agentId`, `status`, `limit`

### `POST /api/inbox`

Create an inbox item.

### `PATCH /api/inbox/:id`

Update an inbox item (mark read, archive, etc.).

### `POST /api/inbox/bulk`

Bulk update inbox items.

### `GET /api/inbox/stats`

Get unread counts by priority tier.

---

## Org Chart

### `GET /api/org-chart`

Get the full org chart (humans + agents, reporting lines).

### `POST /api/org-chart`

Create an org chart node.

### `PATCH /api/org-chart/:nodeId`

Update an org chart node (role, parent, delegation rules).

### `POST /api/org-chart/delegate`

Delegate authority between nodes.

---

## Skills

### `GET /api/skills`

List all installed skills.

### `POST /api/skills`

Install a skill.

### `GET /api/skills/:id`

Get skill details.

### `PATCH /api/skills/:id`

Update a skill.

### `DELETE /api/skills/:id`

Remove a skill.

### `GET /api/skills/:id/agents`

List agents using this skill.

### `GET /api/skills/browse`

Browse available skills from registries (ClawHub, etc.).

### `POST /api/skills/import`

Import a skill from a registry.

---

## Blueprints (Team Templates)

### `GET /api/blueprints`

List available team blueprints.

### `GET /api/blueprints/:id`

Get blueprint details.

### `POST /api/blueprints`

Create a custom blueprint.

### `POST /api/blueprints/deploy`

Deploy a blueprint (creates agents, org chart, skills in one click).

---

## Budgets & Cost Tracking

### `GET /api/budgets`

List budget allocations.

### `GET /api/budgets/:agentId`

Get budget for a specific agent.

### `POST /api/budgets`

Set a budget allocation.

### `GET /api/cost-events`

List cost events (LLM calls, API usage).

### `GET /api/cost-events/summary`

Aggregated cost summary by agent/time period.

---

## Approval Gates

### `GET /api/approval-gates`

List approval gates (rules that require human approval before agent actions).

### `POST /api/approval-gates`

Create an approval gate.

### `PATCH /api/approval-gates/:id`

Update an approval gate.

### `GET /api/approval-requests`

List pending approval requests.

### `PATCH /api/approval-requests/:id`

Approve or deny a request.

---

## Escalation Paths

### `GET /api/escalation-paths`

List escalation paths.

### `POST /api/escalation-paths`

Create an escalation path.

### `PATCH /api/escalation-paths/:id`

Update an escalation path.

---

## Companies & Users

### `GET /api/companies`

List companies the user belongs to.

### `POST /api/companies`

Create a company.

### `GET /api/companies/:id`

Get company details.

### `PATCH /api/companies/:id`

Update company settings.

### `GET /api/companies/:id/members`

List company members.

### `POST /api/companies/:id/invite`

Invite a user to the company.

### `POST /api/companies/:id/logo`

Upload company logo.

### `GET /api/users`

List users.

### `POST /api/users/invite`

Send an invitation.

### `POST /api/invite/accept`

Accept an invitation.

### `GET /api/invite/validate`

Validate an invitation token.

---

## Auth

### `GET /api/auth/status`

Get current authentication status.

### `POST /api/auth/signup`

Create a new account.

### `GET|POST /api/auth/[...nextauth]`

NextAuth.js endpoints (sign in, sign out, session, providers).

---

## Runtimes & OpenClaw Integration

### `GET /api/runtimes`

List configured runtimes (OpenClaw gateways).

### `POST /api/runtimes`

Add a runtime.

### `POST /api/runtimes/probe`

Test connectivity to a runtime.

### `POST /api/runtimes/import`

Import agents from a connected runtime.

### `GET /api/runtime/status`

Get runtime connection status.

### `GET /api/runtime/check`

Health check for runtime connectivity.

### `GET /api/openclaw/health`

OpenClaw gateway health status.

### `GET /api/openclaw/agents`

List agents from connected OpenClaw gateway.

### `GET /api/openclaw/nodes`

List connected OpenClaw nodes.

### `POST /api/openclaw/nodes/push`

Push configuration to a node.

---

## Activity & Audit

### `GET /api/activity`

Activity feed (recent actions across the workspace).

### `GET /api/audit-log`

Full audit trail for compliance and debugging.

---

## Schedules & Automations

### `GET /api/schedules`

List scheduled jobs.

### `POST /api/schedules`

Create a schedule.

### `PATCH /api/schedules/:id`

Update a schedule.

### `POST /api/schedules/push`

Push schedule to runtime.

### `GET /api/automations/runs`

List automation run history.

### `POST /api/automations/sync`

Sync automations with runtime.

---

## Heartbeats

### `GET /api/heartbeat-schedules`

List heartbeat schedules.

### `POST /api/heartbeat-schedules`

Create a heartbeat schedule.

### `PATCH /api/heartbeat-schedules/:id`

Update a heartbeat schedule.

### `GET /api/heartbeat-executions`

List heartbeat execution history.

### `GET /api/heartbeat-executions/:id`

Get a specific heartbeat execution.

### `POST /api/agents/heartbeat`

Trigger an agent heartbeat manually.

---

## Docs (Knowledge Base)

### `GET /api/docs`

List documents. Filterable by `category`, `docType`, `visibility`, `projectId`, `taskId`, `search`, `pinned`, `tags`.

### `POST /api/docs`

Create a document.

### `GET /api/docs/:id`

Get a document.

### `PATCH /api/docs/:id`

Update a document.

### `DELETE /api/docs/:id`

Delete a document.

---

## Provider Keys

### `GET /api/provider-keys`

List configured AI provider keys (keys are masked).

### `POST /api/provider-keys`

Save a provider API key.

### `DELETE /api/provider-keys`

Remove a provider key.

### `GET /api/providers/:provider/models`

List available models for a provider.

---

## System Settings

### `GET /api/system-settings`

Get system-level settings.

### `PATCH /api/system-settings`

Update system settings.

---

## Config Versions

### `GET /api/config-versions`

List configuration version history.

### `POST /api/config-versions/:id/rollback`

Rollback to a previous configuration.

---

## Routines

### `GET /api/routines`

List agent routines.

### `POST /api/routines`

Create a routine.

### `PATCH /api/routines/:id`

Update a routine.

---

## Time Entries

### `GET /api/time-entries`

List time entries across all tasks.

---

## Workspace

### `GET /api/workspace/files`

List workspace files.

### `GET /api/workspace/file?path=...`

Read a workspace file.

### `POST /api/workspace/push`

Push files to the workspace.

---

## Webhooks

### `POST /api/webhooks/github`

GitHub webhook receiver (PR events, CI status, etc.).

---

## Speech

### `POST /api/tts`

Text-to-speech. **Body:** `{ "text": "...", "voice": "..." }`

### `POST /api/stt`

Speech-to-text (audio upload).

---

## Cron (Internal)

### `POST /api/cron/triage`

Run inbox triage (internal scheduler endpoint).

### `POST /api/cron/axiom-research`

Run research automation (internal scheduler endpoint).
