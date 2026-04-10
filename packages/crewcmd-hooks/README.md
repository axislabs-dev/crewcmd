# @axislabs/crewcmd-hooks

OpenClaw hook pack for CrewCmd. It traces `sessions_spawn` / `sessions_send` activity into CrewCmd chat so dispatched agent work shows up in the CrewCmd UI automatically.

## What it does

- intercepts persisted OpenClaw tool results
- extracts the dispatched task, agent id, session key, task id, and completion payload when available
- writes a local queue item synchronously
- spawns a detached worker to POST the trace into CrewCmd's `/api/chat/messages`
- never blocks the gateway on network availability

## Runtime config

Zero-config defaults:

- `CREWCMD_URL` → defaults to `https://localhost:3000`
- `HEARTBEAT_SECRET` → sent as `Authorization: Bearer <secret>` when set
- `CREWCMD_COMPANY_ID` → optional explicit company override
- `AXISLABS_COMPANY_ID` → optional fallback company override

If no company id is present in the tool payload, the hook will use `CREWCMD_COMPANY_ID`, then `AXISLABS_COMPANY_ID`, then a built-in Axislabs default.

## Install

```bash
./packages/crewcmd-hooks/scripts/setup-hook.sh
```

That script builds the package, copies it into `~/.openclaw/hooks/crewcmd-hooks`, enables `subagent-trace`, and restarts the gateway.
