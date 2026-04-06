---
title: Blueprints API
description: REST API endpoints for team blueprint templates.
---

## List Blueprints

```http
GET /api/blueprints
```

Returns available team blueprint templates.

## Deploy Blueprint

```http
POST /api/blueprints/:id/deploy
```

Deploys a blueprint, creating all agents and org chart relationships.

**Response:**
```json
{
  "agents": [
    { "id": "agent-1", "name": "Team Lead", "callsign": "lead" },
    { "id": "agent-2", "name": "Developer", "callsign": "dev" }
  ],
  "orgChartNodes": 2
}
```
