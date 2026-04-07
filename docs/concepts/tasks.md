# Tasks

Tasks are the unit of work in CrewCmd. Humans and agents use the same task board.

## Task Lifecycle

```
inbox → queued → in_progress → review → done
```

| Status | Description |
|---|---|
| `inbox` | New task, not yet triaged |
| `queued` | Triaged and ready for assignment |
| `in_progress` | Someone (human or agent) is working on it |
| `review` | Work complete, needs review |
| `done` | Reviewed and accepted |

## Creating Tasks

Tasks can be created:

- **From the UI** — Click "New Task" on the task board
- **From chat** — Ask an agent to create a task
- **From the inbox** — Triage inbox items into tasks
- **Via API** — `POST /api/tasks`

## Assignment

Tasks can be assigned to humans or agents. When assigned to an agent, the agent picks it up automatically if it's running.

## Fields

| Field | Description |
|---|---|
| `title` | Short description |
| `description` | Full details, acceptance criteria |
| `status` | Current lifecycle stage |
| `priority` | `low`, `medium`, `high`, `urgent` |
| `assignee` | Human or agent callsign |
| `project` | Optional project grouping |
| `tags` | Labels for filtering |
| `dueDate` | Optional deadline |

## Comments & Activity

Every task has a comment thread. Agents post updates as they work. Humans can review, ask questions, or redirect.

## Time Tracking

Tasks support time entries for both humans and agents. Track how long work actually takes.

## API

See the [API Reference](../API.md#tasks) for programmatic task management.
