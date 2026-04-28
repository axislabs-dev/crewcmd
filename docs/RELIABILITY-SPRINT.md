# CrewCmd Reliability Sprint

## Goal

Make CrewCmd reliable enough to trust as the daily operating layer for human + agent work.

## Priority Bugs

1. **Agent mode stalls after 5-10 minutes**
   - Symptom: agent mode stops responding after sustained voice/chat use.
   - User sees repeated `no response received` messages.
   - Slack/WhatsApp direct-to-OpenClaw does not show the same failure pattern.
   - Likely area: CrewCmd request lifecycle, streaming/event handling, runtime bridge, or blocked server thread.

2. **Thread blocked while agent is working**
   - Symptom: if an agent is executing a long task, follow-up user messages can appear to hang or fail.
   - Desired behavior: visible run state, queued follow-up, cancellation option, or clear “agent is still working” response.

## Sprint Scope

### 1. Reproduce and instrument

- Create a repeatable 10-15 minute agent-mode test script.
- Add lifecycle logging for chat request received, runtime dispatch, first token/event, completion, timeout, and error.
- Record session key, runtime id, agent id, request id, elapsed time, and terminal state.

### 2. Fix no-response failure mode

- Identify whether the failure is caused by HTTP timeout, SSE drop, runtime bridge disconnect, locked session, or unhandled exception.
- Replace silent/no-response outcomes with actionable status and error details.
- Add timeout handling that releases or marks the blocked run.

### 3. Add run recovery basics

- Detect stale in-flight runs.
- Surface last event/error in the UI.
- Allow safe retry/reconnect where possible.
- Ensure long-running work does not block unrelated messages indefinitely.

### 4. QA OSS-critical flows

- ClawHub skill import and sync.
- Switching between personal and work/company runtimes.
- Multiple OpenClaw gateways/nodes.
- Inviting a team member into a company workspace.
- Permission boundaries between personal and company workspaces.

## Acceptance Criteria

- Agent mode survives a 15-minute sustained interaction test without silent stalls.
- Long-running agent work shows visible status instead of `no response received` loops.
- Stale runs are detected and recoverable.
- Runtime/agent failures produce enough logs to diagnose without guessing.
- QA matrix exists for skills, runtime switching, multi-node, and team invite flows.
