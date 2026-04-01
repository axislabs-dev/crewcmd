# OpenClaw Integration — Design Spec

> CrewCmd ↔ OpenClaw Gateway: Import, manage, and deploy agent teams.

## Overview

CrewCmd is the **management plane**. OpenClaw (or future runtimes like NanoClaw) is the **execution plane**. Users bring their own runtime environment. CrewCmd connects to it, imports their team, and becomes the single pane of glass for managing agents, skills, models, and hierarchy.

This spec covers:
1. Gateway connection model
2. Onboarding import flow
3. Agent sync and management
4. Blueprint → runtime deploy (push direction)
5. Schema changes

---

## 1. Gateway Connection Model

### How OpenClaw communicates

OpenClaw Gateway exposes two interfaces:

| Interface | Protocol | Use |
|-----------|----------|-----|
| **HTTP** | `POST /v1/chat/completions` | Chat/task execution (OpenAI-compatible) |
| **WebSocket** | `ws://host:port` + JSON-RPC | Management: agents, models, skills, files |

The WebSocket protocol uses a handshake (`connect` frame with auth token) followed by JSON-RPC method calls (`agents.list`, `models.list`, etc.).

### Available RPC methods (from gateway protocol schema)

**Agents:**
- `agents.list` → `{ defaultId, mainKey, scope, agents: [{ id, name, identity: { name, theme, emoji, avatar, avatarUrl } }] }`
- `agents.create` → `{ name, workspace, emoji?, avatar? }` → `{ ok, agentId, name, workspace }`
- `agents.update` → `{ agentId, name?, workspace?, model?, avatar? }` → `{ ok, agentId }`
- `agents.delete` → `{ agentId, deleteFiles? }` → `{ ok, agentId, removedBindings }`
- `agents.files.list` → `{ agentId }` → `{ agentId, workspace, files: [{ name, path, missing, size, content }] }`
- `agents.files.get` → `{ agentId, name }` → `{ agentId, workspace, file: { name, path, content, ... } }`
- `agents.files.set` → `{ agentId, name, content }` → `{ ok, file: { ... } }`

**Models:**
- `models.list` → `{ models: [{ id, name, provider, contextWindow?, reasoning? }] }`

**Skills:**
- `skills.status` → `{ agentId? }` → installed skills per agent
- `skills.bins` → available skill binaries
- `skills.install` → install a skill
- `skills.update` → enable/disable, set API key, env vars

**Tools:**
- `tools.catalog` → `{ agentId?, includePlugins? }` → available tools grouped by source

### Connection storage

Gateway connections are stored at the **company level**, not per-agent:

```sql
-- New table: company_runtimes
company_runtimes (
  id            uuid PK
  company_id    uuid FK → companies
  runtime_type  text NOT NULL  -- 'openclaw' | 'nanoclaw' | 'custom'
  name          text NOT NULL  -- user-friendly label, e.g. "My Mac Mini"
  gateway_url   text NOT NULL  -- 'ws://localhost:18789' | 'wss://my-server:18789'
  http_url      text NOT NULL  -- 'http://localhost:18789' | 'https://my-server:18789'
  auth_token    text           -- encrypted gateway auth token
  is_primary    boolean        -- default runtime for new agents
  status        text           -- 'connected' | 'disconnected' | 'error'
  last_ping     timestamp
  metadata      jsonb          -- { version, agentCount, capabilities }
  created_at    timestamp
  updated_at    timestamp
)
```

This allows:
- Multiple runtimes per company (local dev machine + production VPS)
- Runtime-type agnostic (OpenClaw today, others tomorrow)
- The `http_url` is derived from `gateway_url` automatically but can be overridden

### Agent ↔ Runtime link

Each imported agent gets a `runtimeId` reference:

```sql
-- Add to agents table:
runtime_id     uuid FK → company_runtimes  -- which runtime this agent runs on
runtime_ref    text                          -- the agent ID on the runtime side (e.g. "cipher")
```

This decouples CrewCmd's internal agent ID from the runtime's agent ID. An agent can be moved between runtimes (e.g., local → cloud) by changing the reference.

---

## 2. Onboarding — "Connect OpenClaw" Flow

### Step 2 options (updated)

Current:
- 🏗️ Choose a Blueprint
- ✏️ Start from Scratch

New:
- 🏗️ Choose a Blueprint
- 🔌 **Connect Your Runtime** ← new
- ✏️ Start from Scratch

### Connect flow

```
┌─────────────────────────────────────────┐
│  CONNECT YOUR RUNTIME                    │
│                                          │
│  Gateway URL                             │
│  ┌────────────────────────────────────┐  │
│  │ ws://localhost:18789              │  │  ← pre-filled default
│  └────────────────────────────────────┘  │
│                                          │
│  Auth Token                              │
│  ┌────────────────────────────────────┐  │
│  │ ••••••••••••••••••••              │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ▸ Advanced: custom HTTP URL, runtime    │
│    type, connection name                 │
│                                          │
│  [← BACK]              [CONNECT →]       │
└─────────────────────────────────────────┘
```

On "Connect":

1. **Server-side probe** (`POST /api/runtimes/probe`):
   - Opens WebSocket to gateway URL with auth token
   - Sends `connect` handshake frame
   - On `hello-ok`, calls `agents.list` + `models.list` + per-agent `agents.files.get` (IDENTITY.md, SOUL.md)
   - Returns discovered agents + models to the client
   - Closes WebSocket

2. **Preview** — shows discovered agents in a card grid:
   ```
   ┌─────────────────────────────────────────┐
   │  FOUND 12 AGENTS                         │
   │                                          │
   │  ☑ 🕶️ Neo — CEO                         │
   │  ☑ ⚡ Cipher — CTO                       │
   │  ☑ 🔥 Havoc — CMO                        │
   │  ☑ 🎰 Maverick — CFO                     │
   │  ☑ 📡 Pulse — Trend Intel                │
   │  ☑ ✂️ Razor — Creative Dir               │
   │  ☑ 👻 Ghost — SEO Lead                   │
   │  ☑ 🐍 Viper — Growth Lead               │
   │  ☑ 🛡️ Sentinel — Code Review            │
   │  ☑ 🔨 Forge — Senior Engineer            │
   │  ☑ ⚡ Blitz — Senior Engineer            │
   │  ☑ 🧠 Axiom — Quant Research             │
   │                                          │
   │  Models available: 7                     │
   │  claude-opus-4, claude-haiku, llama3...  │
   │                                          │
   │  [PICK ANOTHER]     [IMPORT 12 AGENTS]   │
   └─────────────────────────────────────────┘
   ```

3. **Import** (`POST /api/runtimes/import`):
   - Creates `company_runtimes` record with encrypted token
   - For each selected agent, creates a record in `agents` table:
     - `callsign` → from runtime agent ID (uppercased)
     - `name` → from `identity.name` or IDENTITY.md or agent ID
     - `emoji` → from `identity.emoji` or default
     - `title` → parsed from SOUL.md or IDENTITY.md or "Agent"
     - `model` → from runtime's primary model config
     - `adapter_type` → `openclaw_gateway`
     - `adapter_config` → `{ url: httpUrl }` (for task execution)
     - `runtime_id` → FK to the company_runtimes record
     - `runtime_ref` → the original agent ID on the runtime
   - Infers `reportsTo` hierarchy if workspace files contain it
   - Auto-creates skills from `skills.status` response
   - Moves to Step 3

### Why server-side probe (not browser WebSocket)?

- **Security:** Auth token never leaves the server. Browser JS can't hold secrets safely.
- **CORS:** Gateway WebSocket may not allow browser origins. Server-to-server has no CORS issues.
- **Remote access:** Browser can't reach `ws://192.168.x.x:18789` on a different network. Server can if it's on the same network/Tailscale.

For the case where CrewCmd is hosted (e.g., Vercel) and the gateway is local to the user's machine: we offer a **local agent** option — a lightweight CLI (`crewcmd connect`) or browser extension that bridges the gap. But that's v2. For v1, server + gateway must be network-reachable.

---

## 3. Agent Sync & Management

### Sync model: CrewCmd-owned, runtime-synced

CrewCmd's database is the source of truth for:
- Hierarchy (reportsTo)
- Skills assignments
- RBAC / access grants
- Canvas positions
- Cost tracking

The runtime is the source of truth for:
- Live status (online/idle/working)
- Session data
- Execution output
- Available models and tools

### Live status polling

`GET /api/runtimes/[runtimeId]/status` — server calls gateway:
- `agents.list` for basic presence
- Per-agent health data for session activity
- Updates `agentHeartbeats` table

Polling interval: 30s (configurable). Uses server-sent events for real-time push on the Team page.

### Agent detail slide panel (Team page)

When clicking an agent on the canvas/grid/tree, a slide-out panel opens with tabs:

**Overview tab:**
- Avatar/emoji (large)
- Name, callsign, title
- Status badge (live from runtime)
- Description (from `soulContent`)
- Reports to (dropdown, changes `reportsTo`)
- Runtime badge: "Running on [runtime name]" with status dot

**Skills tab:**
- Installed skills from CrewCmd DB (agent_skills join)
- "Add Skill" button → opens skill marketplace/browser
- Toggle enabled/disabled per skill
- Skill config (expandable per skill)

**Config tab:**
- Model selector (populated from `models.list`)
- Provider (derived from model or explicit)
- Adapter type (usually `openclaw_gateway`, read-only for imported agents)
- Environment variables (stored in `adapterConfig`)
- Workspace path (from runtime)
- Prompt template

**Access tab (RBAC):**
- Which users can interact with this agent
- Permission levels: interact / configure / view logs
- Reads from `agentAccessGrants` table

**Activity tab:**
- Recent tasks (from `tasks` table, filtered by `assignedAgentId`)
- Cost events (from `costEvents`)
- Chat history / audit trail (from `auditLog`)
- Session output (from runtime via `agents/[callsign]/output`)

### Managing agents from CrewCmd

| Action | CrewCmd DB | Runtime sync |
|--------|-----------|-------------|
| Rename agent | Update `agents.name` | Call `agents.update` on gateway |
| Change model | Update `agents.model` | Call `agents.update` on gateway |
| Add/remove skill | Update `agent_skills` | Call `skills.update` on gateway |
| Change hierarchy | Update `agents.reportsTo` | No runtime call (CrewCmd-only concept) |
| Change RBAC | Update `agentAccessGrants` | No runtime call (CrewCmd-only concept) |
| Delete agent | Delete from `agents` | Optionally call `agents.delete` on gateway |
| Create agent | Insert to `agents` | Call `agents.create` on gateway |
| Edit SOUL.md | — | Call `agents.files.set` on gateway |
| Start agent | Update status | Call `/api/agents/[callsign]/start` (existing) |
| Stop agent | Update status | Call `/api/agents/[callsign]/stop` (existing) |

---

## 4. Blueprint → Runtime Deploy (Push Direction)

When a user deploys a blueprint, and they have a connected runtime:

1. Create agents in CrewCmd DB (existing flow)
2. **Additionally**, for each agent:
   - Call `agents.create` on the gateway → creates the agent in OpenClaw
   - Call `agents.files.set` to write SOUL.md with the agent's personality
   - Call `agents.files.set` to write IDENTITY.md with name, emoji, etc.
   - If model specified, call `agents.update` to set the model
3. Agents are now both in CrewCmd DB and live in the runtime
4. Runtime starts them, they appear online

This makes blueprints truly "one-click": the user's runtime is fully configured.

If no runtime is connected, agents are created in DB only with status "offline" and adapter_type set to a placeholder. User can connect a runtime later and "push" their team to it.

---

## 5. Schema Changes Summary

### New table: `company_runtimes`

```
company_runtimes
├── id              uuid PK
├── company_id      uuid FK → companies
├── runtime_type    text         -- 'openclaw' | 'nanoclaw' | 'custom'
├── name            text         -- "Roger's MacBook" | "Production VPS"
├── gateway_url     text         -- WebSocket URL
├── http_url        text         -- HTTP URL for chat/tasks
├── auth_token      text         -- encrypted
├── is_primary      boolean
├── status          text         -- connected | disconnected | error
├── last_ping       timestamp
├── metadata        jsonb        -- { version, capabilities, agentCount }
├── created_at      timestamp
└── updated_at      timestamp
```

### Agents table additions

```
agents (existing) + add:
├── runtime_id      uuid FK → company_runtimes (nullable)
└── runtime_ref     text (nullable)  -- agent ID on the runtime side
```

### New API routes

```
POST   /api/runtimes/probe          — Test gateway connection + discover agents
POST   /api/runtimes                — Save a runtime connection
GET    /api/runtimes                — List company runtimes
GET    /api/runtimes/[id]           — Get runtime details
PATCH  /api/runtimes/[id]           — Update runtime config
DELETE /api/runtimes/[id]           — Disconnect runtime
GET    /api/runtimes/[id]/status    — Live status from gateway
POST   /api/runtimes/[id]/sync      — Pull latest agent data from gateway
POST   /api/runtimes/import         — Import discovered agents to DB
POST   /api/runtimes/[id]/deploy    — Push agents/blueprint to gateway
```

---

## 6. Implementation Phases

### Phase 1: Connect + Import (build now)
- [ ] `company_runtimes` schema + migration
- [ ] `runtime_id` + `runtime_ref` columns on agents
- [ ] Gateway WebSocket client (server-side, Node.js)
- [ ] `/api/runtimes/probe` endpoint
- [ ] `/api/runtimes` CRUD endpoints
- [ ] `/api/runtimes/import` endpoint
- [ ] Onboarding Step 2c: "Connect Your Runtime" UI
- [ ] Agent preview grid with toggle selection
- [ ] PGlite migration for new columns

### Phase 2: Live Status + Team Management
- [ ] `/api/runtimes/[id]/status` polling
- [ ] Agent detail slide panel (5 tabs)
- [ ] Two-way sync: changes in CrewCmd → push to gateway
- [ ] Real-time status via SSE on Team page

### Phase 3: Blueprint → Runtime Deploy
- [ ] Deploy endpoint pushes to gateway
- [ ] SOUL.md / IDENTITY.md generation for blueprint agents
- [ ] Model assignment on deploy
- [ ] "Push team to runtime" button on Team page

### Phase 4: Multi-Runtime
- [ ] Multiple runtimes per company
- [ ] Agent migration between runtimes
- [ ] Runtime health dashboard
- [ ] NanoClaw adapter (when available)

---

## 7. Security Considerations

- **Token storage:** Gateway auth tokens are encrypted at rest in the DB. Never sent to the browser. All gateway calls go through CrewCmd's server-side API routes.
- **Network:** For local gateways, server and gateway are on the same machine. For remote, user must ensure network reachability (Tailscale, VPN, public endpoint with TLS).
- **Scoping:** Each runtime is scoped to a company. Multi-tenant isolation is enforced — one company can't see another's runtimes.
- **Audit:** All import/sync/deploy actions are logged in `auditLog`.
