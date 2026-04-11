---
name: subagent-trace
type: tool_result_persist
entry: ./handler.js
description: Trace subagent dispatch prompts and completions into CrewCmd chat.
---

# CrewCmd Hooks

This pack currently ships one hook: `subagent-trace`.

## Hooks

- `subagent-trace` — captures `sessions_spawn` and `sessions_send` tool persistence events and mirrors them into CrewCmd chat history.
