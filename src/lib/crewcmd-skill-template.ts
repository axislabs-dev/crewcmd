/**
 * Generate the SKILL.md content that teaches OpenClaw agents
 * how to use CrewCmd's full workspace management API.
 */

import { CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT } from "@/lib/skills/crewcmd-management";

interface CrewCmdSkillConfig {
  /** Base URL of the CrewCmd instance (e.g. http://100.64.1.5:3000) */
  baseUrl: string;
  /** Workspace ID for scoping */
  workspaceId: string;
  /** Optional company ID for company-backed workspaces */
  companyId?: string | null;
}

const capabilityContractTable = CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT
  .map((entry) => `| \`${entry.capability}\` | \`${entry.method} ${entry.path}\` | ${entry.notes} |`)
  .join("\n");

export function generateCrewCmdSkill(config: CrewCmdSkillConfig): string {
  const { baseUrl, workspaceId, companyId } = config;
  const scopeSummary = companyId
    ? `Compatible company scope: ${companyId}`
    : "This workspace is personal and has no company scope.";
  const runtimeScopeSummary = companyId
    ? "Company runtimes are scoped to the company workspace they own or are attached to. Personal runtimes are scoped to the owning user's personal workspace."
    : "Personal runtimes are scoped to the owning user's personal workspace. Do not assume company-only APIs are available without a companyId.";

  return `---
name: crewcmd
description: CrewCmd management API for tasks, projects, agents, inbox, blueprints, budgets, docs, and activity.
version: "2.1"
---

# CrewCmd Management

You are connected to a CrewCmd workspace.
Preferred workspace scope: ${workspaceId}
${scopeSummary}
${runtimeScopeSummary}
Use these API endpoints to manage your workspace: tasks, projects, agents, inbox, blueprints, budgets, documents, and activity.

## Operating rules

- Use task comments as the audit trail for work: starting, progress, blockers, handoffs, review context, and completion notes.
- If you change task status or make a meaningful decision, add a task comment so humans and agents can reconstruct what happened.
- If you need something from a human, create an inbox message instead of silently blocking.
- Blockers, questions, review requests, and decision requests must create a human inbox item.
- Prefer updating an existing task and commenting on it over creating duplicate tasks for the same thread of work.
- Keep comments and inbox messages concise, operational, and explicit about the next action needed.
- If you are acting as a developer or reviewer, code delivery must include a branch, atomic commits, a PR, and linked task PR metadata before the task moves to review.

## Scope and Identifiers

- \`workspaceId\` is the preferred scope for workspace-bound operations. Include it in list/create requests whenever the endpoint accepts it.
- \`companyId\` is only the company backing a company workspace. It is a compatible fallback for some existing endpoints under runtime bearer auth, but it is not a substitute for \`workspaceId\` when a workspace-scoped endpoint asks for explicit scope.
- \`runtimeId\` identifies the CrewCmd runtime making the request. Send it as \`X-CrewCmd-Runtime-Id\`; do not put it in request bodies unless a specific endpoint documents a \`runtimeId\` field.
- A personal runtime can only use the personal workspace resolved for its owner. A company runtime can only use the company workspace resolved for its owning company. Bearer auth does not grant cross-workspace access.
- Company-only APIs require a real \`companyId\`. In personal scope, avoid company members, org chart, company approvals, and company budget administration unless a human explicitly provides valid company scope and authorization.

## Authentication

Runtime bearer auth is the expected auth mode for this skill. Mutating requests (POST, PATCH, DELETE) require the bearer token, and bearer-scoped list/read requests must include explicit \`workspaceId\` or \`companyId\` where the endpoint requires scoped listing.
Every runtime-scoped request must also identify which CrewCmd runtime is calling.
Use the \`HEARTBEAT_SECRET\` and \`CREWCMD_RUNTIME_ID\` environment variables from your runtime:

\`\`\`
Authorization: Bearer $HEARTBEAT_SECRET
X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID
\`\`\`

Read both values from your environment at runtime. Never hardcode them.

Base URL: \`${baseUrl}\`

## Capability Contract

The installed \`crewcmd-management\` skill metadata exposes exactly the capabilities below. Other CrewCmd endpoints may exist, but they are outside this skill's declared agent-facing contract unless another skill or a human instruction explicitly authorizes them.

| Capability | Endpoint | Contract |
| --- | --- | --- |
${capabilityContractTable}

---

## Tasks

### List Tasks

\`\`\`
GET ${baseUrl}/api/tasks?workspaceId=${workspaceId}&status={status}&agentId={agentId}
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
  "source": "agent_initiative",
  "workspaceId": "${workspaceId}"
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

Important:
- developer/reviewer tasks require \`prUrl\` before \`status: "review"\`
- use \`humanAttentionType\` plus a short title/body when you need a human blocker/question/review/decision inbox item

### Submit Completion Report

\`\`\`
POST ${baseUrl}/api/tasks/{id}/complete
Content-Type: application/json

{
  "repo": "owner/repo",
  "branch": "feat/my-feature",
  "commits": [
    { "hash": "abc1234", "message": "Fix the bug" },
    { "hash": "def5678", "message": "Add tests" }
  ],
  "prUrl": "https://github.com/owner/repo/pull/42",
  "validationRun": {
    "ci": "pass",
    "tests": "pass",
    "lint": "pass",
    "timestamp": "2026-04-26T04:00:00.000Z"
  },
  "executionSuccess": true,
  "executionErrors": [],
  "notes": "Task completed — all acceptance criteria met"
}
\`\`\`

Fields:
- \`repo\` (required) — GitHub repo in owner/repo format
- \`branch\` (required) — Branch name containing the work
- \`commits\` — Array of commit objects with \`hash\` (7+ hex chars) and \`message\`
- \`prUrl\` — Pull request URL (strongly recommended for code-delivery tasks)
- \`validationRun\` — CI/test/lint status and timestamp
- \`executionSuccess\` — Whether the agent believes the work succeeded
- \`executionErrors\` — Array of error strings if execution failed
- \`notes\` — Free-form completion notes

The supervisor validates the report and will reject it if:
- Required fields (repo, branch) are missing
- For developer/reviewer role packs: prUrl is required before review/done
- Commit hashes are in invalid format

On acceptance, the endpoint updates task metadata, logs the completion, and posts a summary comment.

### Add Comment

\`\`\`
POST ${baseUrl}/api/tasks/{id}/comments
Content-Type: application/json

{
  "content": "Progress update or blocker explanation",
  "agentId": "your-agent-uuid",
  "humanAttentionType": "blocker",
  "humanAttentionTitle": "Need human decision on deployment target",
  "humanAttentionBody": "Production rollout is blocked until the deployment target is confirmed."
}
\`\`\`

### List Task Comments

\`\`\`
GET ${baseUrl}/api/tasks/{id}/comments
\`\`\`

Use this before major updates so you can preserve context and avoid repeating work already captured on the task.

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
GET ${baseUrl}/api/projects?workspaceId=${workspaceId}&status={status}&ownerId={ownerId}
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
  "ownerAgentId": "uuid",
  "workspaceId": "${workspaceId}"
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
GET ${baseUrl}/api/agents?workspaceId=${workspaceId}
\`\`\`

Use \`workspaceId\` when possible. \`companyId\` remains a compatible shorthand under runtime bearer auth.

Returns agents with:
- \`id\` — CrewCmd agent UUID
- \`callsign\` — dispatchable agent callsign for \`/api/agents/{callsign}/task\`
- \`runtimeRef\` — runtime agent reference when available
- status, current task, workspace/runtime metadata

For queue dispatch:
1. list agents for the workspace
2. match task \`assignedAgentId\` to agent \`id\`
3. use that agent's \`callsign\` when dispatching work

If this workspace is personal, avoid company-only endpoints like members, org chart, company budgets, and company approvals unless you are explicitly given a valid company scope.

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
\`\`\`

### Assign Task to Agent

\`\`\`
POST ${baseUrl}/api/agents/{callsign}/task
Content-Type: application/json

{
  "taskId": "uuid-of-task",
  "prompt": "Concrete work instructions for the agent"
}
\`\`\`

This endpoint requires a real \`prompt\`. It does not infer task content automatically.
Always include the task title, summary, constraints, and what the agent should update in CrewCmd.

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

\`\`\`bash
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"agents":[{"agent_id":"YOUR_AGENT_ID","callsign":"YOUR_CALLSIGN","status":"active","last_active":"'"\$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}]}' \\
  "${baseUrl}/api/agents/heartbeat"
\`\`\`

Payload shape:

\`\`\`json
Content-Type: application/json

{
  "agents": [
    {
      "agent_id": "uuid",
      "callsign": "neo",
      "status": "active",
      "current_task": "optional short status",
      "last_active": "2026-05-06T00:00:00Z",
      "session_count": 1,
      "raw_data": {}
    }
  ]
}
\`\`\`

---

## Inbox

### List Messages

\`\`\`
GET ${baseUrl}/api/inbox?workspaceId=${workspaceId}&status={status}&priority={priority}&type={type}&limit=50&offset=0
\`\`\`

Query parameters (all optional except workspace scope under bearer auth):
- \`status\` — Message status filter
- \`priority\` — \`critical\`, \`high\`, \`normal\`, \`low\`
- \`type\` — Message type filter
- \`limit\` — Max results (default 50)
- \`offset\` — Pagination offset (default 0)

Use inbox when you need:
- approval
- clarification
- credentials or access
- priority decisions
- escalation on blockers

### Send Message

\`\`\`
POST ${baseUrl}/api/inbox
Content-Type: application/json

{
  "workspaceId": "${workspaceId}",
  "fromAgentId": "your-agent-uuid",
  "toAgentId": "target-agent-uuid",
  "type": "question",
  "priority": "normal",
  "title": "Message title",
  "body": "Message content",
  "context": {},
  "actions": []
}
\`\`\`

Fields:
- \`toAgentId\` or \`toUserId\` — Recipient (agent or human)
- \`type\` — One of \`decision\`, \`blocker\`, \`completed\`, \`question\`, \`escalation\`, \`update\`, \`approval\`
- \`priority\` — \`critical\`, \`high\`, \`normal\`, \`low\`

### Update Message

\`\`\`
PATCH ${baseUrl}/api/inbox/{id}
Content-Type: application/json

{ "status": "actioned", "actionResult": "Approved deploy", "actionedBy": "user" }
\`\`\`

Updatable fields: \`status\`, \`actionResult\`, \`snoozeUntil\`, \`actionedBy\`.

---

## Documents

### List Documents

\`\`\`
GET ${baseUrl}/api/docs?workspaceId=${workspaceId}&category={cat}&docType={type}&visibility={vis}&search={query}&projectId={id}&taskId={id}&tags={comma,separated}&pinned=true
\`\`\`

All query parameters are optional.

### Create Document

\`\`\`
POST ${baseUrl}/api/docs
Content-Type: application/json

{
  "title": "Document title (required)",
  "content": "Document body (required)",
  "workspaceId": "${workspaceId}",
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

### Get Blueprint

\`\`\`
GET ${baseUrl}/api/blueprints/{id}
\`\`\`

---

## Budgets

### List Budgets

\`\`\`
GET ${baseUrl}/api/budgets?company_id={companyId}
\`\`\`

### Get Agent Budget

\`\`\`
GET ${baseUrl}/api/budgets/{agentId}
\`\`\`

---

## Activity

### Activity Log

\`\`\`
GET ${baseUrl}/api/activity?agentId={agentId}&actionType={type}&limit=50
\`\`\`

---

## Workflow Guidelines

1. **Starting work**: Update task status to \`in_progress\` and add a task comment.
2. **Progress updates**: Add comments explaining decisions, progress, or blockers.
3. **Blocked**: Add a comment explaining why and what you need. Do NOT silently stop.
4. **Completing work**: Set status to \`review\`. Link the PR if applicable.
5. **Creating tasks**: Discovered work → create task with \`source: "agent_initiative"\`.
6. **Collaboration**: Use inbox to communicate with other agents or humans.
7. **Documentation**: Create docs for runbooks, decisions, and knowledge sharing.
8. **Budget awareness**: Check your budget before starting expensive operations.
9. **Always log**: Every significant action should appear in the task board, task comments, or inbox.
10. **Human asks go to inbox**: approvals, questions, blockers, and requests for credentials belong in inbox messages.

## Example: Full Task Lifecycle

\`\`\`bash
# 1. Check your assigned tasks
curl -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  "${baseUrl}/api/tasks?status=queued&agentId=YOUR_AGENT_ID"

# 2. Start working on a task
curl -X PATCH -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress"}' \\
  "${baseUrl}/api/tasks/TASK_ID"

# 3. Add a progress comment
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Found root cause in auth middleware.", "agentId": "YOUR_AGENT_ID"}' \\
  "${baseUrl}/api/tasks/TASK_ID/comments"

# 4. Ask for human or agent input via inbox
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"companyId": "${companyId}", "fromAgentId": "YOUR_AGENT_ID", "toAgentId": "OTHER_AGENT_ID", "type": "question", "priority": "normal", "title": "Need review", "body": "Please review PR #42"}' \\
  "${baseUrl}/api/inbox"

# 5. Mark as ready for review with PR link
curl -X PATCH -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "review", "prUrl": "https://github.com/org/repo/pull/42", "prStatus": "open"}' \\
  "${baseUrl}/api/tasks/TASK_ID"

# 6. Add final audit-trail comment
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Implemented fix, opened PR #42, ready for review.", "agentId": "YOUR_AGENT_ID"}' \\
  "${baseUrl}/api/tasks/TASK_ID/comments"

# 7. Submit a structured completion report when the task is complete
curl -X POST -H "Authorization: Bearer $HEARTBEAT_SECRET" \\
  -H "X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"repo": "owner/repo", "branch": "feat/my-feature", "executionSuccess": true, "executionErrors": [], "notes": "Ready for review"}' \\
  "${baseUrl}/api/tasks/TASK_ID/complete"
\`\`\`
`;
}
