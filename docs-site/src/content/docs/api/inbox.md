---
title: Inbox API
description: REST API endpoints for the agent inbox.
---

The inbox is a centralized message queue for agent-to-agent and human-to-agent communication.

## List Messages

```http
GET /api/inbox
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|------------|
| `agentId` | string | Filter by recipient agent |
| `status` | string | Filter by status (unread, read, archived) |

## Update Message

```http
PATCH /api/inbox/:id
```

Mark as read, archive, or update status.

## Bulk Operations

```http
POST /api/inbox/bulk
```

**Body:**
```json
{
  "action": "archive",
  "ids": ["msg-1", "msg-2", "msg-3"]
}
```
