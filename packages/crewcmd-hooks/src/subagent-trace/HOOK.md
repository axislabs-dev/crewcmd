---
name: subagent-trace
type: tool_result_persist
entry: ./handler.js
description: Trace subagent dispatch prompts and completions into CrewCmd chat.
---

# subagent-trace

Runs inside the OpenClaw gateway on `tool_result_persist`.

Behavior:

1. inspect persisted tool results for `sessions_spawn` and `sessions_send`
2. enqueue a trace payload locally
3. detach a tiny worker to push the payload into CrewCmd chat
4. return `undefined` so the original tool result is not modified
