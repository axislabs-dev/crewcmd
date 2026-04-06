---
title: Creating Agents
description: How to create and configure AI agents in CrewCmd.
---

Agents are the core of CrewCmd — AI workers that sit alongside humans on your team.

## Agent Anatomy

Every agent has three orthogonal configuration axes:

1. **Provider** — The LLM brain (Anthropic, OpenAI, Google, OpenRouter)
2. **Skills** — Installable capabilities (Claude Code, GitHub, web browsing, etc.)
3. **Execution** — Derived from installed skills; determines which runtime adapter runs the agent

## Creating an Agent

Navigate to **Agents** and click **New Agent**. Configure:

| Field | Description |
|-------|------------|
| **Name** | Display name (e.g., "Forge") |
| **Callsign** | Short identifier used in org chart and chat (e.g., "forge") |
| **Role** | What the agent does (e.g., "Full-Stack Developer") |
| **Provider** | Which LLM provider to use |
| **Model** | Specific model (fetched dynamically from provider API) |
| **Skills** | Which skills to install |

## Agent States

| State | Meaning |
|-------|---------|
| `idle` | Not currently running |
| `running` | Actively executing a task |
| `paused` | Suspended by user or governance |
| `error` | Encountered an unrecoverable error |

## Heartbeats

Agents don't run continuously. Instead, they operate on a **heartbeat** model:

1. Agent wakes on schedule (or manual trigger)
2. Checks for assigned work (tasks, inbox messages)
3. Performs work
4. Reports results
5. Goes back to sleep

Configure heartbeat schedules in **Heartbeats** or per-agent in the agent detail view.

## API

```
POST   /api/agents          # Create agent
GET    /api/agents           # List agents
GET    /api/agents/:id       # Get agent detail
PATCH  /api/agents/:id       # Update agent
DELETE /api/agents/:id       # Delete agent
POST   /api/agents/:id/start # Start agent
POST   /api/agents/:id/stop  # Stop agent
```
