---
name: crewcmd
description: Manage tasks, projects, agents, and inbox via the CrewCmd API. Use when creating, updating, listing, or dispatching tasks; managing projects; checking agent status; sending inbox items; or any task/project board operations. Replaces any external task board (Mission Control, Jira, Linear, etc.) when CrewCmd is the configured workspace backend. Triggers on: task creation, task updates, project management, agent dispatch, inbox operations, board queries, "create a task", "what's queued", "update the task", "mark as done".
---

# CrewCmd — Task & Agent Management

CrewCmd is the task board, inbox, and agent management backend. All task operations go through its REST API.

## Connection

- **Base URL:** Provided via `CREWCMD_URL` env var, or defaults to `https://localhost:3000`
- **Auth:** `Authorization: Bearer <HEARTBEAT_SECRET>` for mutations. GETs are public.
- Use `-k` flag with curl (self-signed TLS in local dev).

## Task Lifecycle

```
inbox → queued → in_progress → review → done
```

- `inbox`: Unsorted, needs triage
- `queued`: Ready for dispatch to an agent or human
- `in_progress`: Actively being worked on
- `review`: Work done, awaiting review
- `done`: Complete

## Core Operations

### List tasks

```
GET /api/tasks?status=queued&priority=high&limit=10
```

Filters: `status`, `agentId`, `humanAssignee`, `projectId`, `priority`, `unassigned=true`, `excludeHumanAssignee=true`, `since=<ISO|unix_ms>`

### Create task

```
POST /api/tasks
{
  "title": "[Feature] Build X",
  "description": "## Scope\n- [ ] ...",
  "status": "queued",
  "priority": "high",
  "assignedAgentId": "forge",
  "humanAssignee": null,
  "projectId": "<uuid>",
  "branch": "feat/x",
  "repo": "org/repo",
  "source": "manual",
  "createdBy": "neo"
}
```

Priority: `critical`, `high`, `medium`, `low`. Status defaults to `inbox` if omitted.

### Get task

```
GET /api/tasks/:id
GET /api/tasks/TSK-123
```

Supports UUID or `TSK-NNN` shortId format. Response includes `projectContext` if the task has a project.

### Update task

```
PATCH /api/tasks/:id
{ "status": "in_progress", "assignedAgentId": "cipher" }
```

Updatable fields: `title`, `description`, `status`, `priority`, `assignedAgentId`, `humanAssignee`, `projectId`, `prUrl`, `prStatus`, `branch`, `repo`, `reviewNotes`, `reviewCycleCount`, `sortIndex`, `source`, `images`

### Delete task

```
DELETE /api/tasks/:id
```

### Task comments

```
GET  /api/tasks/:id/comments
POST /api/tasks/:id/comments  { "content": "...", "author": "neo" }
```

## Projects

```
GET    /api/projects
POST   /api/projects         { "name": "...", "description": "...", "status": "active" }
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
```

Projects have a `context` field (markdown) that gets included with task responses for project-scoped tasks.

## Inbox

Agent-to-human escalation and notifications.

```
GET  /api/inbox?priority=high&status=unread&limit=10
POST /api/inbox  { "title": "...", "body": "...", "priority": "high", "agentId": "forge" }
PATCH /api/inbox/:id  { "status": "read" }
GET  /api/inbox/stats
```

## Agent Dispatch Pattern

When assigning work to an agent:

1. Create or update task with `assignedAgentId` and `status: "in_progress"`
2. Include `branch`, `repo` if code work
3. Agent reports back by updating task: `status: "review"`, `prUrl`, `reviewNotes`
4. Reviewer (human or sentinel) moves to `done` or back to `in_progress` with `reviewNotes`

## Heartbeat Schedules

```
GET  /api/heartbeat-schedules
POST /api/heartbeat-schedules  { "agentId": "neo", "intervalMinutes": 30 }
POST /api/agents/heartbeat     (trigger manual heartbeat)
```

## Activity & Audit

```
GET /api/activity        (recent actions feed)
GET /api/audit-log       (full compliance trail)
```

## Error Handling

- `401`: Missing or invalid Bearer token (mutations only)
- `404`: Task/project not found
- `409`: Duplicate task (when `errorHash` matches existing non-done task)
- `503`: Database not configured or connection failed

## Conventions

- Prefix task titles: `[Feature]`, `[Bug]`, `[Chore]`, `[Content]`, `[Data]`, `[QA]`
- Use markdown checklists in descriptions for acceptance criteria
- One logical change per task; create follow-on tasks for downstream work
- Always include `createdBy` when creating tasks programmatically

For full API reference including chat, runtimes, skills, blueprints, budgets, approvals, and more: read `references/api-full.md`.
