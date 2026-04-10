---
name: crewcmd-hooks
description: Hook pack that traces OpenClaw subagent dispatches into CrewCmd chat.
---

# CrewCmd Hooks

This pack currently ships one hook: `subagent-trace`.

## Hooks

- `subagent-trace` — captures `sessions_spawn` and `sessions_send` tool persistence events and mirrors them into CrewCmd chat history.
