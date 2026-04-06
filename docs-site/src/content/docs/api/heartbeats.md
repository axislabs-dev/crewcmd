---
title: Heartbeats API
description: REST API endpoints for agent scheduling and heartbeat execution.
---

Heartbeats are the scheduling mechanism for agents. Agents wake on schedule, process work, and go back to sleep.

## Schedules

### List Schedules

```http
GET /api/heartbeat-schedules
```

### Create Schedule

```http
POST /api/heartbeat-schedules
```

**Body:**
```json
{
  "agentId": "agent-uuid",
  "cron": "*/15 * * * *",
  "enabled": true
}
```

### Update Schedule

```http
PATCH /api/heartbeat-schedules/:id
```

### Delete Schedule

```http
DELETE /api/heartbeat-schedules/:id
```

## Executions

### List Executions

```http
GET /api/heartbeat-executions
```

Returns heartbeat execution logs.

**Query Parameters:**
| Param | Type | Description |
|-------|------|------------|
| `agentId` | string | Filter by agent |
| `status` | string | Filter by status (success, error, running) |
