---
title: Agents API
description: REST API endpoints for managing AI agents.
---

## List Agents

```http
GET /api/agents
```

Returns all agents for the current company.

**Query Parameters:**
| Param | Type | Description |
|-------|------|------------|
| `status` | string | Filter by status (idle, running, paused, error) |
| `search` | string | Search by name or callsign |

## Create Agent

```http
POST /api/agents
```

**Body:**
```json
{
  "name": "Forge",
  "callsign": "forge",
  "role": "Full-Stack Developer",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "config": {}
}
```

## Get Agent

```http
GET /api/agents/:id
```

## Update Agent

```http
PATCH /api/agents/:id
```

## Delete Agent

```http
DELETE /api/agents/:id
```

## Start Agent

```http
POST /api/agents/:id/start
```

Triggers the agent to wake up and begin processing work.

## Stop Agent

```http
POST /api/agents/:id/stop
```

## Restart Agent

```http
POST /api/agents/:id/restart
```

## Get Agent Output

```http
GET /api/agents/:id/output
```

Returns the agent's execution output stream.

## Agent Skills

```http
GET    /api/agents/:id/skills       # List installed skills
POST   /api/agents/:id/skills       # Install a skill
DELETE /api/agents/:id/skills/:sid   # Remove a skill
```

## Assign Task

```http
POST /api/agents/:id/tasks
```

Assigns a task to the agent.
