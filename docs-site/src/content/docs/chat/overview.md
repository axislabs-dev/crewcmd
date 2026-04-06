---
title: Chat Interface
description: Communicate with your AI agents through a unified chat interface.
---

The chat interface is how humans interact with agents in real-time. It supports text, voice, and streaming responses.

## How It Works

1. Select an agent from the hierarchy tree selector
2. Type a message or use voice input
3. The message is sent to the agent's execution runtime
4. Responses stream back via Server-Sent Events (SSE)

## Features

- **Streaming responses** — See agent output as it's generated
- **Markdown rendering** — Agent responses render with full Markdown support
- **Session management** — Conversations persist across page reloads
- **Multi-agent** — Switch between agent threads without losing context
- **Message attribution** — See who sent each message (human, agent, parent agent)

## Chat API

```
POST   /api/chat              # Send message (SSE stream response)
GET    /api/chat/sessions      # List chat sessions
GET    /api/chat/history       # Get message history for a session
GET    /api/chat/events        # Real-time event stream
```

## Voice Input

CrewCmd supports hands-free voice interaction:
- Browser-native speech recognition for input
- Text-to-speech for agent responses (browser `speechSynthesis` by default)
- Optional OpenAI TTS for higher-quality voice output
