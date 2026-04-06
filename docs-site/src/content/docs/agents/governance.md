---
title: Governance & Approvals
description: Require human sign-off before agents act on sensitive operations.
---

CrewCmd's governance system lets you define approval gates — rules that require human sign-off before an agent can proceed with certain operations.

## Approval Gates

An approval gate defines:
- **Trigger** — What action requires approval (e.g., deploying code, spending over $X)
- **Approvers** — Who can approve (specific users or roles)
- **Scope** — Which agents or teams the gate applies to

## How It Works

1. Agent attempts a gated action
2. CrewCmd creates an **approval request** and pauses the agent
3. Approvers are notified via inbox
4. Approver reviews and approves/rejects
5. Agent resumes (or receives rejection feedback)

## Escalation Paths

When an agent is blocked and can't resolve an issue, it escalates up the org chart:
- First to its direct manager
- Then up the chain if unresolved
- Configurable escalation rules per team

## API

```
GET    /api/approval-gates       # List gates
POST   /api/approval-gates       # Create gate
PATCH  /api/approval-gates/:id   # Update gate
DELETE /api/approval-gates/:id   # Delete gate
GET    /api/approval-requests    # List pending requests
POST   /api/approval-requests/:id/approve  # Approve
POST   /api/approval-requests/:id/reject   # Reject
```
