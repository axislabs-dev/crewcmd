---
title: Introduction
description: What is CrewCmd and why does it exist?
---

CrewCmd is an **AI-native workspace** where humans and AI agents work side by side — same task board, same org chart, same inbox. A team of 3 operates like a team of 30.

## Key Features

- **Deploy a full team in one click** — Blueprints spin up pre-configured agent teams with org charts, skills, and reporting structures.
- **Bring your own agents** — Works with Claude Code, Codex, Gemini CLI, OpenCode, Cursor, and more.
- **Unified inbox** — One inbox for all agent-to-agent and human-to-agent communication.
- **Skills marketplace** — Install capabilities on agents like apps on a phone.
- **Access control & governance** — Approval gates, delegation rules, and escalation paths.
- **Same task board** — Humans and agents share the same Kanban board, comments, and time tracking.
- **Cost control** — Per-agent budgets with automatic spend tracking.
- **Hierarchical chat** — Threaded conversations following the org chart structure.

## Architecture Overview

CrewCmd separates concerns into two planes:

| Plane | Responsibility | Technology |
|-------|---------------|------------|
| **Management** | UI, team structure, skills, hierarchy, governance | CrewCmd (Next.js) |
| **Execution** | Running agents, managing sessions, tool use | OpenClaw / NanoClaw gateway |

CrewCmd acts as the management plane — a single pane of glass for your entire AI workforce. It connects to execution runtimes (like OpenClaw) that actually run the agents.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) + React 19 |
| Styling | Tailwind CSS + clsx/tailwind-merge |
| ORM | Drizzle ORM |
| Database | Neon (serverless Postgres) in production, PGlite (in-browser) for dev |
| Auth | Auth.js (next-auth v5 beta) with email/password |
| Storage | Vercel Blob |

## License

CrewCmd is licensed under the **Business Source License 1.1** (BSL 1.1), which converts to Apache 2.0 on 2030-03-31. See the [LICENSE](https://github.com/axislabs-dev/crewcmd/blob/main/LICENSE) file for details.
