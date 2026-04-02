/**
 * Generate the SKILL.md content that teaches OpenClaw agents
 * how to use CrewCmd's Task Management API.
 */

interface CrewCmdSkillConfig {
  /** Base URL of the CrewCmd instance (e.g. http://100.64.1.5:3000) */
  baseUrl: string;
  /** Bearer token for API auth (HEARTBEAT_SECRET) */
  authToken: string;
  /** Company ID for scoping (informational, not sent in requests) */
  companyId: string;
}

export function generateCrewCmdSkill(config: CrewCmdSkillConfig): string {
  const { baseUrl, authToken, companyId } = config;

  return `---
name: crewcmd
description: Manage tasks, report progress, and collaborate with your team through CrewCmd's task board.
version: "1.0"
---

# CrewCmd Task Management

You are connected to a CrewCmd workspace (company: ${companyId}).
Use these API endpoints to manage your tasks, report progress, and collaborate.

## Authentication

All requests require a Bearer token in the Authorization header:

\`\`\`
Authorization: Bearer ${authToken}
\`\`\`

Base URL: \`${baseUrl}\`

## Endpoints

### List Tasks

\`\`\`
GET ${baseUrl}/api/tasks?status={status}&agentId={agentId}
\`\`\`

Query parameters (all optional):
- \`status\` — Filter by status: \`inbox\`, \`queued\`, \`in_progress\`, \`review\`, \`done\`
- \`agentId\` — Filter tasks assigned to a specific agent ID
- \`priority\` — Filter by priority: \`low\`, \`medium\`, \`high\`, \`urgent\`
- \`unassigned=true\` — Only show unassigned tasks
- \`since\` — ISO timestamp or Unix ms, returns tasks updated after this time

Returns an array of task objects.

### Create Task

\`\`\`
POST ${baseUrl}/api/tasks
Content-Type: application/json

{
  "title": "Task title (required)",
  "description": "Detailed description of what needs to be done",
  "status": "inbox",
  "priority": "medium",
  "assignedAgentId": "uuid-of-agent",
  "source": "agent_initiative"
}
\`\`\`

Fields:
- \`title\` (required) — Short summary of the task
- \`description\` — Detailed description, context, acceptance criteria
- \`status\` — One of: \`inbox\` (default), \`queued\`, \`in_progress\`, \`review\`, \`done\`
- \`priority\` — One of: \`low\`, \`medium\` (default), \`high\`, \`urgent\`
- \`assignedAgentId\` — UUID of the agent to assign (use your own ID to self-assign)
- \`source\` — One of: \`manual\`, \`agent_initiative\`, \`error_log\`, \`test_failure\`

Returns the created task object with \`id\` and \`shortId\` (TSK-NNNN format).

### Get Task Detail

\`\`\`
GET ${baseUrl}/api/tasks/{id}
\`\`\`

Supports both UUID and TSK-NNNN format. Returns the full task object including project context.

### Update Task

\`\`\`
PATCH ${baseUrl}/api/tasks/{id}
Content-Type: application/json

{
  "status": "in_progress",
  "description": "Updated description with progress notes"
}
\`\`\`

Updatable fields:
- \`status\` — Update task status (triggers activity log)
- \`priority\` — Change priority
- \`assignedAgentId\` — Reassign to another agent
- \`description\` — Update description with progress details
- \`prUrl\` — Link a pull request URL
- \`prStatus\` — PR status: \`open\`, \`merged\`, \`closed\`
- \`branch\` — Git branch name
- \`repo\` — Repository identifier
- \`reviewNotes\` — Notes for reviewers

### Add Comment

\`\`\`
POST ${baseUrl}/api/tasks/{id}/comments
Content-Type: application/json

{
  "content": "Comment text explaining what you did or why you're blocked",
  "agentId": "your-agent-uuid"
}
\`\`\`

Fields:
- \`content\` (required) — The comment text
- \`agentId\` — Your agent UUID (links the comment to you in the activity feed)

## Workflow Guidelines

1. **Starting work**: When you pick up a task, update its status to \`in_progress\`.
2. **Progress updates**: Add comments explaining what you did, decisions made, or issues found.
3. **Blocked**: If you're blocked, add a comment explaining why and what you need. Do NOT silently stop.
4. **Completing work**: Update the task status to \`review\` when done. Link the PR if applicable.
5. **Creating tasks**: If you discover work that needs doing, create a new task with \`source: "agent_initiative"\`.
6. **Always log**: Every action you take should be reflected in the task board — status changes, comments, or new tasks.

## Example: Full Task Lifecycle

\`\`\`bash
# 1. Check your assigned tasks
curl -H "Authorization: Bearer ${authToken}" \\
  "${baseUrl}/api/tasks?status=queued&agentId=YOUR_AGENT_ID"

# 2. Start working on a task
curl -X PATCH -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress"}' \\
  "${baseUrl}/api/tasks/TASK_ID"

# 3. Add a progress comment
curl -X POST -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Investigating the issue. Found root cause in auth middleware.", "agentId": "YOUR_AGENT_ID"}' \\
  "${baseUrl}/api/tasks/TASK_ID/comments"

# 4. Mark as ready for review with PR link
curl -X PATCH -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "review", "prUrl": "https://github.com/org/repo/pull/42", "prStatus": "open"}' \\
  "${baseUrl}/api/tasks/TASK_ID"
\`\`\`
`;
}
