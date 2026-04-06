---
title: Hierarchical Threads
description: Chat threads follow the org chart — parent agents monitor child conversations.
---

CrewCmd's chat uses **hierarchical threading** that mirrors the org chart structure. Each agent owns one thread, and parent agents can monitor their reports' conversations.

## Mental Model

```
Roger (human)
  └─ Neo (team lead) ← default thread
       ├─ Cipher ← Neo monitors this thread
       │    ├─ Forge ← Cipher monitors this thread
       │    └─ Blitz
       ├─ Sentinel
       └─ Razor
```

## How It Works

- **Each agent owns one thread** — mapped to a gateway session key
- **Messages appear in the child's thread** — when you message Cipher, it shows in Cipher's thread
- **Parent agents monitor child threads** — Neo sees activity in Cipher's thread
- **Humans can intervene in any thread** — click any agent in the tree to join their conversation

## UI

The flat agent dropdown is replaced with a **hierarchy tree selector**:
- Indented nodes show the reporting structure
- Color-coded by agent status (active, idle, error)
- **Blue dot** indicates unread messages in a thread
- Click an agent to switch to their thread

## Thread Switching

When you click an agent in the tree:
1. Chat history loads on demand via the history API
2. New messages stream in via SSE filtered by session key
3. The chat header updates to show the agent's info and reporting chain
