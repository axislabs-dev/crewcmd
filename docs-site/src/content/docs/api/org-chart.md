---
title: Org Chart API
description: REST API endpoints for managing the organizational hierarchy.
---

## Get Org Chart

```http
GET /api/org-chart
```

Returns the full org chart tree for the current company.

## Create Node

```http
POST /api/org-chart
```

**Body:**
```json
{
  "agentId": "agent-uuid",
  "parentId": "parent-node-uuid",
  "position": { "x": 100, "y": 200 }
}
```

## Update Node

```http
PATCH /api/org-chart/:id
```

Reparent a node or update its canvas position.

## Delete Node

```http
DELETE /api/org-chart/:id
```

Removes a node from the org chart (does not delete the agent).
