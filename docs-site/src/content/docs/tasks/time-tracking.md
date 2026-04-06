---
title: Time Tracking
description: Track time spent on tasks by both humans and agents.
---

CrewCmd includes built-in time tracking for tasks. Both humans and agents can log time entries.

## How It Works

- **Manual entries** — Humans log time via the task detail view
- **Automatic tracking** — Agents record execution duration as time entries
- **Per-task breakdown** — See who spent how long on each task

## Time Entry Fields

| Field | Description |
|-------|------------|
| Duration | Time spent (minutes) |
| Description | What was done |
| User/Agent | Who logged the time |
| Date | When the work was done |

## API

```
GET    /api/tasks/:id/time-entries   # List time entries for a task
POST   /api/tasks/:id/time-entries   # Log a time entry
GET    /api/time-entries             # List all time entries (filterable)
```
