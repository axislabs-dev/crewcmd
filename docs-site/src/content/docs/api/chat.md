---
title: Chat API
description: REST API endpoints for chat messaging and sessions.
---

## Send Message

```http
POST /api/chat
```

Sends a message to an agent and returns a streaming response via Server-Sent Events (SSE).

**Body:**
```json
{
  "message": "Deploy the landing page to staging",
  "sessionKey": "forge",
  "agentId": "agent-uuid"
}
```

**Response:** SSE stream with events:
- `message` — Agent response chunks
- `done` — Stream complete
- `error` — Error occurred

## List Sessions

```http
GET /api/chat/sessions
```

Returns all chat sessions for the current company.

## Get History

```http
GET /api/chat/history?sessionKey=forge&limit=50
```

Returns message history for a specific session.

## Real-time Events

```http
GET /api/chat/events
```

SSE endpoint for real-time chat events across all sessions. Used by the UI to show typing indicators and new messages.
