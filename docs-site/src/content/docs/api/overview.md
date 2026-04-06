---
title: API Overview
description: Overview of the CrewCmd REST API.
---

CrewCmd exposes a comprehensive REST API under `/api/`. All routes return `NextResponse.json()` responses.

## Authentication

Most API routes require authentication via Auth.js session cookies. The session identifies the user and their active company.

## Base URL

```
https://your-crewcmd-instance.com/api
```

## Response Format

All responses follow a consistent JSON format:

```json
{
  "data": { ... },
  "error": null
}
```

Error responses:

```json
{
  "data": null,
  "error": "Description of what went wrong"
}
```

## Endpoint Groups

| Group | Base Path | Description |
|-------|-----------|------------|
| [Agents](/api/agents/) | `/api/agents` | Agent CRUD, start/stop, output, skills |
| [Chat](/api/chat/) | `/api/chat` | Messages, sessions, streaming |
| [Tasks](/api/tasks/) | `/api/tasks` | Task CRUD, comments, images, time |
| [Skills](/api/skills/) | `/api/skills` | Skill management, marketplace |
| [Providers](/api/providers/) | `/api/providers` | Model listing by provider |
| [Org Chart](/api/org-chart/) | `/api/org-chart` | Hierarchy management |
| [Budgets](/api/budgets/) | `/api/budgets` | Budget and cost tracking |
| [Governance](/api/governance/) | `/api/approval-gates` | Approval gates and requests |
| [Inbox](/api/inbox/) | `/api/inbox` | Agent inbox messages |
| [Blueprints](/api/blueprints/) | `/api/blueprints` | Team templates |
| [Heartbeats](/api/heartbeats/) | `/api/heartbeat-schedules` | Agent scheduling |
| [OpenClaw](/api/openclaw/) | `/api/openclaw` | Gateway integration |

## Rate Limiting

API routes do not currently enforce rate limits. For production deployments, consider adding rate limiting at the infrastructure level (e.g., Vercel, Cloudflare).
