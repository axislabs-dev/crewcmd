---
title: Skills API
description: REST API endpoints for skill management and marketplace.
---

## List Skills

```http
GET /api/skills
```

Returns all skills (built-in + custom) available to the current company.

## Browse Marketplace

```http
GET /api/skills/browse
```

Browse skills available in the marketplace.

## Create Custom Skill

```http
POST /api/skills
```

**Body:**
```json
{
  "name": "My Custom Skill",
  "description": "A custom integration",
  "runtime": "cli",
  "command": "my-tool --execute",
  "providers": ["anthropic", "openai"]
}
```

## Update Skill

```http
PATCH /api/skills/:id
```

## Delete Skill

```http
DELETE /api/skills/:id
```

## Import Skill

```http
POST /api/skills/import
```

Import a skill definition from an external source.
