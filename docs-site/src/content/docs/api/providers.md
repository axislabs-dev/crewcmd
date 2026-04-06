---
title: Providers API
description: REST API endpoints for LLM provider model listing.
---

## List Models

```http
GET /api/providers/:provider/models
```

Returns available models for a given provider. Results are cached for 1 hour.

**Path Parameters:**
| Param | Values |
|-------|--------|
| `provider` | `anthropic`, `openai`, `google`, `openrouter` |

**Response:**
```json
{
  "models": [
    { "id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4" },
    { "id": "claude-opus-4-20250514", "name": "Claude Opus 4" }
  ]
}
```

## Provider Keys

```http
GET    /api/provider-keys          # List configured providers
POST   /api/provider-keys          # Add provider key
PATCH  /api/provider-keys/:id      # Update key
DELETE /api/provider-keys/:id      # Remove key
```

Provider keys are encrypted at rest and scoped to the current company.
