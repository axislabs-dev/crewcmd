---
title: Governance API
description: REST API endpoints for approval gates and requests.
---

## Approval Gates

### List Gates

```http
GET /api/approval-gates
```

### Create Gate

```http
POST /api/approval-gates
```

**Body:**
```json
{
  "name": "Production Deploy",
  "trigger": "deploy",
  "scope": "all-agents",
  "approvers": ["user-uuid"]
}
```

### Update Gate

```http
PATCH /api/approval-gates/:id
```

### Delete Gate

```http
DELETE /api/approval-gates/:id
```

## Approval Requests

### List Requests

```http
GET /api/approval-requests
```

Returns pending approval requests.

### Approve

```http
POST /api/approval-requests/:id/approve
```

### Reject

```http
POST /api/approval-requests/:id/reject
```

**Body:**
```json
{
  "reason": "Not approved for this environment"
}
```
