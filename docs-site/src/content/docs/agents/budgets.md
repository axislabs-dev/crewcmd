---
title: Budgets & Cost Control
description: Track and control AI agent spending with per-agent budgets.
---

CrewCmd provides per-agent budget allocation and automatic cost tracking to keep your AI workforce accountable.

## Budget Allocation

Each agent can have a spending budget:
- **Monthly limit** — Maximum spend per billing cycle
- **Alert threshold** — Get notified before hitting the limit
- **Hard cap** — Stop the agent when budget is exhausted

## Cost Events

Every LLM API call generates a **cost event** recording:
- Token counts (input + output)
- Cost in dollars
- Which agent, task, and model
- Timestamp

## Cost Summary

View spending breakdowns by:
- Agent
- Time period
- Model / provider
- Task

## API

```
GET    /api/budgets              # List agent budgets
POST   /api/budgets              # Set budget for an agent
PATCH  /api/budgets/:id          # Update budget
GET    /api/cost-events          # List cost events
GET    /api/cost-events/summary  # Aggregated cost summary
```
