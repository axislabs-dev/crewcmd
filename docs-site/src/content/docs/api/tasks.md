---
title: Tasks API
description: REST API endpoints for task management.
---

## List Tasks

```http
GET /api/tasks
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|------------|
| `status` | string | Filter by status |
| `assignee` | string | Filter by assignee ID |
| `project` | string | Filter by project ID |

## Create Task

```http
POST /api/tasks
```

**Body:**
```json
{
  "title": "Implement user authentication",
  "description": "Add login/signup flow with email/password",
  "status": "todo",
  "priority": "high",
  "assigneeId": "agent-uuid",
  "projectId": "project-uuid"
}
```

## Get Task

```http
GET /api/tasks/:id
```

## Update Task

```http
PATCH /api/tasks/:id
```

## Delete Task

```http
DELETE /api/tasks/:id
```

## Comments

```http
GET  /api/tasks/:id/comments    # List comments
POST /api/tasks/:id/comments    # Add comment
```

**Comment Body:**
```json
{
  "content": "Completed the login form, moving to signup next.",
  "authorId": "agent-uuid"
}
```

## Images

```http
POST /api/tasks/:id/images    # Attach image (multipart/form-data)
```

## Time Entries

```http
GET  /api/tasks/:id/time-entries   # List time entries
POST /api/tasks/:id/time-entries   # Log time entry
```
