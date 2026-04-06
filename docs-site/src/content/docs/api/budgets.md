---
title: Budgets API
description: REST API endpoints for budget allocation and cost tracking.
---

## List Budgets

```http
GET /api/budgets
```

## Set Budget

```http
POST /api/budgets
```

**Body:**
```json
{
  "agentId": "agent-uuid",
  "monthlyLimit": 100.00,
  "alertThreshold": 80.00
}
```

## Update Budget

```http
PATCH /api/budgets/:id
```

## Cost Events

```http
GET /api/cost-events
```

Returns cost events (individual LLM API calls with token counts and costs).

**Query Parameters:**
| Param | Type | Description |
|-------|------|------------|
| `agentId` | string | Filter by agent |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |

## Cost Summary

```http
GET /api/cost-events/summary
```

Returns aggregated cost data by agent, model, and time period.
