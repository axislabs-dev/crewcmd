/**
 * Generate the SKILL.md content that teaches OpenClaw agents
 * how to use CrewCmd's full workspace management API.
 */

interface CrewCmdSkillConfig {
  /** Base URL of the CrewCmd instance (e.g. http://100.64.1.5:3000) */
  baseUrl: string;
  /** Company ID for scoping */
  companyId: string;
}

export function generateCrewCmdSkill(config: CrewCmdSkillConfig): string {
  const { baseUrl, companyId } = config;

  return `---
name: crewcmd
description: Full workspace management — tasks, projects, agents, inbox, blueprints, budgets, docs, org chart, and more.
version: "2.0"
---

# CrewCmd Management

You are connected to a CrewCmd workspace (company: ${companyId}).
Use these API endpoints to manage your workspace — tasks, projects, agents, inbox, blueprints, budgets, documents, org chart, and activity.

## Authentication

All mutating requests (POST, PATCH, DELETE) require a Bearer token.
Use the \`HEARTBEAT_SECRET\` environment variable from your runtime:

\`\`\`
Authorization: Bearer $HEARTBEAT_SECRET
\`\`\`

Read the token from your environment at runtime. Never hardcode it.

Base URL: \`${baseUrl}\`

---

## Tasks

### List Tasks

\`\`\`
GET ${baseUrl}/api/tasks?status={status}&agentId={agentId}
\`\`\`

Query parameters (all optional):
- \`status\` — \`inbox\`, \`queued\`, \`in_progress\`, \`review\`, \`done\`
- \`agentId\` — Filter by assigned agent UUID
- \`priority\` — \`low\`, \`medium\`, \`high\`, \`urgent\`
- \`unassigned=true\` — Only unassigned tasks
- \`since\` — ISO timestamp or Unix ms, returns tasks updated after this time

### Create Task

\`\`\`
POST ${baseUrl}/api/tasks
Content-Type: application/json

{
  "title": "Task title (required)",
  "description": "Detailed description",
  "status": "inbox",
  "priority": "medium",
  "assignedAgentId": "uuid-of-agent",
  "source": "agent_initiative"
}
\`\`\`

Fields:
- \`title\` (required) — Short summary
- \`description\` — Detailed description and acceptance criteria
- \`status\` — \`inbox\` (default), \`queued\`, \`in_progress\`, \`review\`, \`done\`
- \`priority\` — \`low\`, \`medium\` (default), \`high\`, \`urgent\`
- \`assignedAgentId\` — UUID of agent to assign
- \`source\` — \`manual\`, \`agent_initiative\`, \`error_log\`, \`test_failure\`

Returns created task with \`id\` and \`shortId\` (TSK-NNNN).

### Get Task Detail

\`\`\`
GET ${baseUrl}/api/tasks/{id}
\`\`\`

Supports UUID or TSK-NNNN format. Returns full task with project context.

### Update Task

\`\`\`
PATCH ${baseUrl}/api/tasks/{id}
Content-Type: application/json

{
  "status": "in_progress",
  "description": "Updated with progress"
}
\`\`\`

Updatable: \`status\`, \`priority\`, \`assignedAgentId\`, \`description\`, \`prUrl\`, \`prStatus\` (open/merged/closed), \`branch\`, \`repo\`, \`reviewNotes\`.

### Add Comment

\`\`\`
POST ${baseUrl}/api/tasks/{id}/comments
Content-Type: application/json

{
  "content": "Progress update or blocker explanation",
  "agentId": "your-agent-uuid"
}
\`\`\`

### Task Time Entries

\`\`\`
GET  ${baseUrl}/api/tasks/{id}/time-entries
POST ${baseUrl}/api/tasks/{id}/time-entries
Content-Type: application/json

{ "agentId": "uuid", "minutes": 30, "description": "Work description" }
\`\`\`

---

## Projects

### List Projects

\`\`\`
GET ${baseUrl}/api/projects?status={status}&ownerId={ownerId}
\`\`\`

Query parameters (all optional):
- \`status\` — Filter by project status
- \`ownerId\` — Filter by owner agent UUID

### Create Project

\`\`\`
POST ${baseUrl}/api/projects
Content-Type: application/json

{
  "name": "Project name (required)",
  "description": "Project description",
  "color": "#3b82f6",
  "status": "active",
  "ownerAgentId": "uuid"
}
\`\`\`

### Get / Update Project

\`\`\`
GET   ${baseUrl}/api/projects/{id}
PATCH ${baseUrl}/api/projects/{id}
Content-Type: application/json

{ "name": "Updated name", "status": "completed" }
\`\`\`

---

## Agents

### List Agents

\`\`\`
GET ${baseUrl}/api/agents
\`\`\`

Returns all agents with status, current task, skills, and config.

### Get / Update Agent

\`\`\`
GET   ${baseUrl}/api/agents/{callsign}
PATCH ${baseUrl}/api/agents/{callsign}
Content-Type: application/json

{ "status": "idle", "currentTask": null }
\`\`\`

### Agent Lifecycle

\`\`\`
POST ${baseUrl}/api/agents/{callsign}/start
POST ${baseUrl}/api/agents/{callsign}/stop
POST ${baseUrl}/api/agents/{callsign}/restart
GET  ${baseUrl}/api/agents/{callsign}/status
GET  ${baseUrl}/api/agents/{callsign}/output
GET  ${baseUrl}/api/agents/{callsign}/output/stream
\`\`\`

### Assign Task to Agent

\`\`\`
POST ${baseUrl}/api/agents/{callsign}/task
Content-Type: application/json

{ "taskId": "uuid-of-task" }
\`\`\`

### Agent Skills

\`\`\`
GET  ${baseUrl}/api/agents/{callsign}/skills
POST ${baseUrl}/api/agents/{callsign}/skills
Content-Type: application/json

{ "skillId": "uuid-of-skill" }
\`\`\`

\`\`\`
DELETE ${baseUrl}/api/agents/{callsign}/skills/{skillId}
\`\`\`

### Heartbeat

\`\`\`
POST ${baseUrl}/api/agents/heartbeat
Content-Type: application/json

{ "agentId": "uuid", "status": "active", "metadata": {} }
\`\`\`

---

## Inbox

### List Messages

\`\`\`
GET ${baseUrl}/api/inbox?company_id={companyId}&status={status}&priority={priority}&type={type}&limit=50&offset=0
\`\`\`

Query parameters (all optional except \`company_id\`):
- \`status\` — Message status filter
- \`priority\` — Priority filter
- \`type\` — Message type filter
- \`limit\` — Max results (default 50)
- \`offset\` — Pagination offset (default 0)

### Send Message

\`\`\`
POST ${baseUrl}/api/inbox
Content-Type: application/json

{
  "companyId": "${companyId}",
  "fromAgentId": "your-agent-uuid",
  "toAgentId": "target-agent-uuid",
  "type": "request",
  "priority": "medium",
  "title": "Message title",
  "body": "Message content",
  "context": {},
  "actions": []
}
\`\`\`

Fields:
- \`toAgentId\` or \`toUserId\` — Recipient (agent or human)
- \`type\` — Message type (e.g. \`request\`, \`notification\`, \`escalation\`)
- \`priority\` — \`low\`, \`medium\`, \`high\`, \`urgent\`

### Get / Update Message

\`\`\`
GET   ${baseUrl}/api/inbox/{id}
PATCH ${baseUrl}/api/inbox/{id}
Content-Type: application/json

{ "status": "read" }
\`\`\`

### Bulk Operations

\`\`\`
POST ${baseUrl}/api/inbox/bulk
Content-Type: application/json

{ "ids": ["uuid1", "uuid2"], "action": "mark_read" }
\`\`\`

### Inbox Stats

\`\`\`
GET ${baseUrl}/api/inbox/stats?company_id={companyId}
\`\`\`

---

## Documents

### List Documents

\`\`\`
GET ${baseUrl}/api/docs?category={cat}&docType={type}&visibility={vis}&search={query}&projectId={id}&taskId={id}&tags={comma,separated}&pinned=true
\`\`\`

All query parameters are optional.

### Create Document

\`\`\`
POST ${baseUrl}/api/docs
Content-Type: application/json

{
  "title": "Document title (required)",
  "content": "Document body (required)",
  "category": "engineering",
  "docType": "runbook",
  "visibility": "team",
  "authorAgentId": "your-agent-uuid",
  "projectId": "uuid",
  "taskId": "uuid",
  "tags": ["tag1", "tag2"],
  "pinned": false
}
\`\`\`

### Get / Update Document

\`\`\`
GET   ${baseUrl}/api/docs/{id}
PATCH ${baseUrl}/api/docs/{id}
Content-Type: application/json

{ "title": "Updated title", "content": "Updated body" }
\`\`\`

---

## Blueprints

### List Blueprints

\`\`\`
GET ${baseUrl}/api/blueprints?category={category}&company_id={companyId}
\`\`\`

Returns built-in and custom blueprints.

### Create Blueprint

\`\`\`
POST ${baseUrl}/api/blueprints
Content-Type: application/json

{
  "name": "Blueprint name (required)",
  "slug": "blueprint-slug (required)",
  "description": "What this team does (required)",
  "category": "engineering",
  "icon": "🛠️",
  "agentCount": 3,
  "companyId": "${companyId}",
  "template": { "agents": [...], "orgChart": [...] }
}
\`\`\`

### Deploy Blueprint

\`\`\`
POST ${baseUrl}/api/blueprints/deploy
Content-Type: application/json

{
  "blueprintId": "uuid",
  "companyId": "${companyId}",
  "customize": {
    "agents": [{ "callsign": "custom-name" }]
  }
}
\`\`\`

Returns \`{ success: true, agents: [...], count: N }\`.

### Get / Update Blueprint

\`\`\`
GET   ${baseUrl}/api/blueprints/{id}
PATCH ${baseUrl}/api/blueprints/{id}
\`\`\`

---

## Org Chart

### Get Org Tree

\`\`\`
GET ${baseUrl}/api/org-chart?company_id={companyId}
\`\`\`

Returns nested org tree structure.

### Create / Update Org Node

\`\`\`
POST ${baseUrl}/api/org-chart
Content-Type: application/json

{
  "companyId": "${companyId}",
  "agentId": "uuid",
  "positionTitle": "Lead Engineer",
  "parentNodeId": "uuid-of-parent",
  "canDelegate": true,
  "sortIndex": 0
}
\`\`\`

### Get / Update Node

\`\`\`
GET   ${baseUrl}/api/org-chart/{nodeId}
PATCH ${baseUrl}/api/org-chart/{nodeId}
Content-Type: application/json

{ "positionTitle": "Senior Engineer", "parentNodeId": "new-parent-uuid" }
\`\`\`

### Delegate

\`\`\`
POST ${baseUrl}/api/org-chart/delegate
Content-Type: application/json

{ "fromNodeId": "uuid", "toNodeId": "uuid", "taskId": "uuid" }
\`\`\`

---

## Budgets

### List Budgets

\`\`\`
GET ${baseUrl}/api/budgets?company_id={companyId}
\`\`\`

### Create / Update Budget

\`\`\`
POST ${baseUrl}/api/budgets
Content-Type: application/json

{
  "agentId": "uuid",
  "companyId": "${companyId}",
  "monthlyLimit": 5000,
  "alertThreshold": 0.8,
  "autoPause": true
}
\`\`\`

Fields:
- \`monthlyLimit\` — Monthly spend cap in cents
- \`alertThreshold\` — Alert when spend reaches this fraction (0-1)
- \`autoPause\` — Pause agent when budget exceeded

### Get / Update Agent Budget

\`\`\`
GET   ${baseUrl}/api/budgets/{agentId}
PATCH ${baseUrl}/api/budgets/{agentId}
Content-Type: application/json

{ "monthlyLimit": 10000 }
\`\`\`

### Cost Events

\`\`\`
GET ${baseUrl}/api/cost-events?agentId={agentId}
GET ${baseUrl}/api/cost-events/summary
\`\`\`

---

## Skills

### List Skills

\`\`\`
GET ${baseUrl}/api/skills?company_id={companyId}
\`\`\`

Returns built-in and custom skills.

### Create Custom Skill

\`\`\`
POST ${baseUrl}/api/skills
Content-Type: application/json

{
  "name": "Skill name (required)",
  "slug": "skill-slug (required)",
  "description": "What the skill does",
  "companyId": "${companyId}",
  "source": "custom",
  "content": "Skill instructions markdown",
  "metadata": {}
}
\`\`\`

### Browse / Import

\`\`\`
GET  ${baseUrl}/api/skills/browse
POST ${baseUrl}/api/skills/import
Content-Type: application/json

{ "url": "https://clawhub.example/skill-package" }
\`\`\`

### Get Skill / Skill Agents

\`\`\`
GET ${baseUrl}/api/skills/{id}
GET ${baseUrl}/api/skills/{id}/agents
\`\`\`

---

## Team Members

### List Members

\`\`\`
GET ${baseUrl}/api/companies/{companyId}/members
\`\`\`

Returns members with userId, role, email, githubUsername.

### Invite Member

\`\`\`
POST ${baseUrl}/api/companies/{companyId}/members
Content-Type: application/json

{
  "email": "user@example.com",
  "role": "member"
}
\`\`\`

Or invite by GitHub username: \`{ "githubUsername": "user", "role": "member" }\`

### Remove Member

\`\`\`
DELETE ${baseUrl}/api/companies/{companyId}/members?memberId={memberId}
\`\`\`

---

## Activity & Audit

### Activity Log

\`\`\`
GET ${baseUrl}/api/activity?agentId={agentId}&actionType={type}&limit=50
\`\`\`

### Log Activity

\`\`\`
POST ${baseUrl}/api/activity
Content-Type: application/json

{
  "agentId": "your-agent-uuid",
  "actionType": "task_completed",
  "description": "Completed migration task TSK-1234",
  "metadata": {}
}
\`\`\`

### Audit Log

\`\`\`
GET ${baseUrl}/api/audit-log
\`\`\`

---

## Heartbeat Schedules

### List / Create Schedules

\`\`\`
GET  ${baseUrl}/api/heartbeat-schedules
POST ${baseUrl}/api/heartbeat-schedules
Content-Type: application/json

{ "agentId": "uuid", "cronExpression": "*/15 * * * *", "enabled": true }
\`\`\`

### Get / Update Schedule

\`\`\`
GET   ${baseUrl}/api/heartbeat-schedules/{id}
PATCH ${baseUrl}/api/heartbeat-schedules/{id}
Content-Type: application/json

{ "enabled": false }
\`\`\`

### Execution Records

\`\`\`
GET  ${baseUrl}/api/heartbeat-executions
POST ${baseUrl}/api/heartbeat-executions
GET  ${baseUrl}/api/heartbeat-executions/{id}
\`\`\`

---

## Approval Gates (Governance)

### List / Create Gates

\`\`\`
GET  ${baseUrl}/api/approval-gates
POST ${baseUrl}/api/approval-gates
Content-Type: application/json

{ "name": "Deploy approval", "companyId": "${companyId}", "triggerType": "deploy", "requiredApprovers": 1 }
\`\`\`

### Approval Requests

\`\`\`
GET  ${baseUrl}/api/approval-requests
POST ${baseUrl}/api/approval-requests
Content-Type: application/json

{ "gateId": "uuid", "requestedBy": "agent-uuid", "context": {} }
\`\`\`

\`\`\`
PATCH ${baseUrl}/api/approval-requests/{id}
Content-Type: application/json

{ "status": "approved", "decidedBy": "user-uuid" }
\`\`\`

---

## Workflow Guidelines

1. **Starting work**: Update task status to \`in_progress\` and log activity.
2. **Progress updates**: Add comments explaining decisions, progress, or blockers.
3. **Blocked**: Add a comment explaining why and what you need. Do NOT silently stop.
4. **Completing work**: Set status to \`review\`. Link the PR if applicable.
5. **Creating tasks**: Discovered work → create task with \`source: "agent_initiative"\`.
6. **Collaboration**: Use inbox to communicate with other agents or humans.
7. **Documentation**: Create docs for runbooks, decisions, and knowledge sharing.
8. **Budget awareness**: Check your budget before starting expensive operations.
9. **Always log**: Every significant action should appear in the task board, activity log, or inbox.

## Example: Full Task Lifecycle

\`\`\`bash
# 1. Check your assigned tasks
curl -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  "${baseUrl}/api/tasks?status=queued&agentId=YOUR_AGENT_ID"

# 2. Start working on a task
curl -X PATCH -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress"}' \\
  "${baseUrl}/api/tasks/TASK_ID"

# 3. Add a progress comment
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Found root cause in auth middleware.", "agentId": "YOUR_AGENT_ID"}' \\
  "${baseUrl}/api/tasks/TASK_ID/comments"

# 4. Send a message to another agent
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"companyId": "${companyId}", "fromAgentId": "YOUR_AGENT_ID", "toAgentId": "OTHER_AGENT_ID", "type": "request", "title": "Need review", "body": "Please review PR #42"}' \\
  "${baseUrl}/api/inbox"

# 5. Mark as ready for review with PR link
curl -X PATCH -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "review", "prUrl": "https://github.com/org/repo/pull/42", "prStatus": "open"}' \\
  "${baseUrl}/api/tasks/TASK_ID"

# 6. Log activity
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": "YOUR_AGENT_ID", "actionType": "task_completed", "description": "Completed TSK-1234"}' \\
  "${baseUrl}/api/activity"
\`\`\`
`;
}
