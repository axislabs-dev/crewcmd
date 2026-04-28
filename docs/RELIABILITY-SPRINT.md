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

## Baseline Context

Recent reliability work already added agent-mode diagnostics and inactivity timeout guards in PRs #229 and #230. Start from that baseline instead of treating the issue as unknown: validate whether the existing diagnostics catch the failure, then close any visibility or recovery gaps.

The current inactivity timeout is 300 seconds. Any 10-15 minute sustained interaction test must either disable that timeout for the test run or explicitly configure it above the planned test duration.

## Sprint Scope

### 1. Reproduce and instrument

- Create a repeatable 10-15 minute agent-mode test script.
- Adjust or disable the 300s inactivity timeout before running sustained tests.
- Validate existing diagnostics first, then add lifecycle logging only where gaps remain: chat request received, runtime dispatch, first token/event, completion, timeout, and error.
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
