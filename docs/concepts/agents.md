# Agents

Agents are AI team members with defined roles, skills, and reporting lines. They show up on the same task board and org chart as humans.

## Creating an Agent

1. Go to **Agents** in the sidebar
2. Click **Add Agent**
3. Configure:
   - **Callsign** — Unique identifier (e.g., `forge`, `blitz`, `sentinel`)
   - **Role** — What they do (e.g., "Full-stack developer", "Code reviewer")
   - **Model** — Which AI model to use (Claude, GPT, Gemini, etc.)
   - **System Prompt** — Instructions that shape the agent's behavior
   - **Skills** — Capabilities from the skills marketplace

## Agent Lifecycle

| Status | Description |
|---|---|
| `idle` | Created but not running |
| `active` | Connected to a runtime and available for work |
| `busy` | Currently executing a task |
| `stopped` | Manually stopped |
| `error` | Runtime connection failed |

## Connecting to Runtimes

Agents need a runtime to execute work. CrewCmd supports:

- **OpenClaw** — Connect agents running on OpenClaw nodes
- **Direct API** — Connect to Claude Code, Codex, Gemini, or any agent with an API
- **Local** — Run agents on the same machine as CrewCmd

Configure runtimes in **Settings > Runtimes**.

## Agent Access Control

- **Private agents** — Only visible to the user who created them
- **Shared agents** — Visible to the whole team
- **Per-agent permissions** — Control who can start, stop, or configure each agent

## Skills

Skills give agents capabilities beyond chat. Install from ClawHub or create your own. See [Skills](skills.md) for details.

## API

See the [API Reference](../API.md#agents) for programmatic agent management.
