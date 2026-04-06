---
title: Built-in Skills
description: Skills that ship with CrewCmd out of the box.
---

Skills are installable capabilities that give agents specific powers. CrewCmd ships with a set of built-in skills.

## Available Built-in Skills

| Skill | Description | Compatible Providers |
|-------|------------|---------------------|
| **claude-code** | Claude Code CLI for coding tasks | Anthropic |
| **codex** | OpenAI Codex CLI | OpenAI |
| **opencode** | OpenCode CLI | Multiple |
| **gemini-cli** | Google Gemini CLI | Google |
| **cursor** | Cursor editor integration | Multiple |
| **pi** | Pi assistant | Multiple |
| **github** | GitHub operations (PRs, issues, etc.) | Any |
| **web-browse** | Web browsing and research | Any |
| **file-system** | Local file system access | Any |
| **shell** | Shell command execution | Any |

## How Skills Work

1. **Install** — Add a skill to an agent via the Skills tab or API
2. **Configure** — Some skills require credentials (managed via the [Credential Vault](/skills/credential-vault/))
3. **Execute** — The primary CLI skill determines which execution adapter runs the agent

## Skill Architecture

Skills are defined with:
- **Runtime** — How the skill executes (CLI, API, etc.)
- **Command** — The actual command to run
- **Provider compatibility** — Which LLM providers the skill works with
- **Credential dependencies** — What API keys or tokens the skill needs

The primary installed skill determines the agent's execution adapter. For example, installing `claude-code` means the agent runs via the Claude Code CLI.

## API

```
GET    /api/skills              # List all skills (built-in + custom)
POST   /api/agents/:id/skills   # Install skill on agent
DELETE /api/agents/:id/skills/:skillId  # Remove skill from agent
```
