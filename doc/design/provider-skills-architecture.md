# Design: Provider + Skills Architecture

> RFC — replaces the current adapter-centric agent model

## Problem

Agents are currently defined by their **adapter** (e.g. `claude_local`, `codex_local`). This conflates three separate concerns:

1. **What LLM powers the agent** (Anthropic, OpenAI, Google)
2. **How the agent executes** (local CLI, API, gateway)
3. **What the agent can do** (code, browse, search)

This leads to:
- Hardcoded, stale model lists per adapter
- No way to give an agent multiple capabilities (e.g. Claude Code + GitHub)
- Confusing UX — users think in terms of "hire an engineer who can code", not "configure a claude_local adapter"

## Proposal

Split agent configuration into three orthogonal concepts:

### 1. Provider (the brain)

The LLM provider determines the model list and API credentials.

| Provider | Models endpoint | Auth |
|---|---|---|
| Anthropic | `GET https://api.anthropic.com/v1/models` | `x-api-key` header |
| OpenAI | `GET https://api.openai.com/v1/models` | `Bearer` token |
| Google | `GET https://generativelanguage.googleapis.com/v1beta/models` | API key in query |
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | `Bearer` token |

- Models are fetched dynamically and cached (1 hour TTL)
- API keys are stored at the **company level** as secrets (not per-agent)
- Provider selection determines which models appear in the dropdown
- OpenRouter is special: too many models for a dropdown, use searchable combobox or free text

### 2. Skills (what they can do)

Skills are installable capabilities. Each skill defines:

```typescript
interface Skill {
  id: string;           // e.g. "claude-code"
  name: string;         // e.g. "Claude Code"
  description: string;  // "Write and edit code using Claude Code CLI"
  category: "coding" | "browsing" | "communication" | "data" | "custom";

  // What this skill needs to run
  runtime: "cli" | "api" | "gateway";
  command?: string;     // CLI command (e.g. "claude", "codex", "opencode")
  
  // Provider compatibility
  compatibleProviders?: string[];  // null = works with any
  
  // Config schema for skill-specific settings
  configSchema?: JSONSchema;
}
```

**Built-in skills:**

| Skill | Runtime | Description |
|---|---|---|
| `claude-code` | cli | Code via Claude Code CLI |
| `codex` | cli | Code via Codex CLI |
| `opencode` | cli | Code via OpenCode CLI |
| `gemini-cli` | cli | Code via Gemini CLI |
| `cursor` | cli | Code via Cursor |
| `pi` | cli | Code via Pi CLI |
| `web-browse` | api | Browse and interact with websites |
| `github` | cli | GitHub operations via `gh` CLI |
| `file-system` | cli | Read/write local files |
| `shell` | cli | Execute shell commands |

**Custom skills** can be installed from a marketplace or created locally (like OpenClaw skills).

### 3. Execution Strategy (how they run)

Derived from the agent's skills and provider, not configured directly:

- Agent has `claude-code` skill → runs via Claude Code CLI
- Agent has `codex` skill → runs via Codex CLI
- Agent has no CLI skill → runs via provider API directly
- Agent has `openclaw-gateway` skill → runs via OpenClaw gateway

The execution engine picks the right strategy based on installed skills.

## Schema Changes

### Current
```sql
agents:
  adapter_type    TEXT     -- "claude_local", "codex_local", etc.
  adapter_config  JSONB   -- { model, command, cwd, ... }
```

### Proposed
```sql
agents:
  provider        TEXT     -- "anthropic", "openai", "google", "openrouter"
  model           TEXT     -- "claude-sonnet-4-20250514"
  
-- New join table
agent_skills:
  agent_id        UUID
  skill_id        TEXT     -- "claude-code", "github", etc.
  config          JSONB    -- skill-specific config (cwd, command overrides, etc.)
  
-- Company-level credentials
company_secrets:
  company_id      UUID
  provider        TEXT     -- "anthropic", "openai", etc.
  encrypted_key   TEXT
```

### Migration Path

The existing `adapter_type` maps cleanly:

| Old adapter_type | New provider | New skill |
|---|---|---|
| `claude_local` | `anthropic` | `claude-code` |
| `codex_local` | `openai` | `codex` |
| `gemini_local` | `google` | `gemini-cli` |
| `opencode_local` | (user picks) | `opencode` |
| `cursor` | (user picks) | `cursor` |
| `pi_local` | (user picks) | `pi` |
| `openclaw_gateway` | (from gateway) | `openclaw-gateway` |
| `openrouter` | `openrouter` | (none, API-only) |

## UX Flow

### Creating an Agent (Simple Mode)

1. **Name + Role** — "What's their name? What do they do?"
2. **Brain** — "Pick a provider" → Anthropic / OpenAI / Google / OpenRouter
3. **Model** — Dynamic dropdown fetched from provider API
4. **Skills** — Checkbox grid of available skills, filtered by compatibility
5. **Done** — Agent is ready to receive tasks

### Creating an Agent (Pro Mode)

Same as above plus:
- Custom skill config (working directory, CLI flags, env vars)
- Execution workspace strategy (git worktrees, Docker)
- Budget and governance settings
- Prompt template customization

### Agent Card (Dashboard)

```
┌─────────────────────────────────────┐
│ 🤖 Cipher                          │
│ Senior Engineer · Anthropic         │
│ claude-sonnet-4-20250514            │
│                                     │
│ Skills: 🔧 Claude Code · 🐙 GitHub │
│ Status: ● Working on CREW-142      │
└─────────────────────────────────────┘
```

## API Changes

### New: `GET /api/providers/:provider/models`
Fetches available models from the provider's API. Requires company-level API key for that provider.

### New: `GET /api/skills`
Lists all available skills (built-in + installed).

### New: `POST /api/agents/:id/skills`
Install a skill on an agent.

### Modified: `POST /api/agents`
```json
{
  "name": "Cipher",
  "role": "engineer",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "skills": [
    { "id": "claude-code", "config": { "cwd": "/home/projects" } },
    { "id": "github" }
  ]
}
```

## Competitive Advantage

- **Paperclip** hardcodes models per adapter, same problem we have today
- **OpenClaw** is single-agent, skills are defined at the platform level
- **CrewCmd with provider + skills** = dynamic models, composable capabilities, HR-native UX

Users think: "I'm hiring someone smart (model) who knows how to code (skill)."
Not: "I'm configuring a claude_local adapter with a model override."

## Implementation Phases

### Phase 1: Dynamic Models (quick win)
- Add `/api/providers/:provider/models` endpoint
- Store provider API keys at company level
- Replace hardcoded model lists with dynamic fetch + cache
- Keep adapter system working underneath

### Phase 2: Skills Abstraction
- Create skills table and agent_skills join table
- Build skills UI (install/remove on agent card)
- Migrate adapter_type → provider + primary skill
- Execution engine reads skills instead of adapter_type

### Phase 3: Skill Marketplace
- Community-contributed skills
- Skill discovery and install flow
- Custom skill authoring (like OpenClaw skill-creator)

## Open Questions

1. **OpenRouter model selection** — Hundreds of models. Searchable combobox? Favorites? Categories?
2. **Multi-skill execution** — If an agent has both `claude-code` and `github`, which drives execution? Primary skill concept?
3. **Provider-agnostic skills** — OpenCode works with any provider. How to handle provider selection for these?
4. **Skill dependencies** — Does `github` skill require `shell` skill? Or are they independent?
