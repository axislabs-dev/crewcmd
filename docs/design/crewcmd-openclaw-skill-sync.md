# Design: CrewCMD → OpenClaw Skill Sync

- **Author:** Forge
- **Status:** Draft
- **Created:** 2026-04-09
- **Target:** v1 (same-machine) + v2 (remote)

## Problem Statement

CrewCMD manages skills (SaaS integrations, marketplace imports, custom uploads) with per-agent assignment, config validation, and secrets storage. OpenClaw loads skills purely from the filesystem — no REST API for skill management. Users need a reliable way to push skill definitions, configuration, and secrets from CrewCMD to each agent's OpenClaw workspace, supporting both co-located and remote OpenClaw deployments.

---

## 1. v1 — Same-Machine Sync

**Assumption:** CrewCMD and OpenClaw run on the same host. CrewCMD has filesystem access to the OpenClaw workspace paths.

### 1.1 Target Paths

| Component | Path |
|---|---|
| Per-agent workspace skills | `~/.openclaw/workspace-<agentId>/skills/<skill-slug>/SKILL.md` |
| Shared/local skills (all agents) | `~/.openclaw/skills/<skill-slug>/SKILL.md` |
| Per-agent config | `~/.openclaw/openclaw.json` → `skills.entries["<skill-slug>"]` |
| CrewCMD skill record | DB (`skills` table) |
| Agent-skill assignment | DB (`agent_skills` table) |

### 1.2 Skill Directory Structure

Each synced skill creates a directory under the target workspace:

```
~/.openclaw/workspace-<agentId>/skills/<skill-slug>/
├── SKILL.md            # AgentSkills spec frontmatter + instructions
├── .crewcmd-meta.json  # Sync metadata (for rollback + verification)
└── ...               # Any additional files (scripts, prompts)
```

**`.crewcmd-meta.json` schema:**

```json
{
  "source": "crewcmd",
  "skillId": "<crewcmd-skills-table-id>",
  "version": "0.1.0",
  "syncedAt": "2026-04-09T16:00:00.000Z",
  "syncedBy": "agent-123",
  "sourceType": "marketplace|custom|saas",
  "previousChecksum": "sha256:abc123..."
}
```

This metadata file is OpenClaw-agnostic (it won't interfere with skill loading) and enables rollback and verification.

### 1.3 SKILL.md Generation

The skill content is generated from the CrewCMD skill record's `content` field plus configuration metadata:

```markdown
---
name: <skill-name>
description: <skill-description>
metadata: {"openclaw": {"requires": {"env": ["<PRIMARY_ENV_VAR>"]}, "primaryEnv": "<PRIMARY_ENV_VAR>"}}
---

<skill content / instructions...>
```

The `metadata.openclaw.requires.env` array is derived from the skill's `configSchema.required` plus any fields with `secretRef`. The `primaryEnv` key connects to OpenClaw's `skills.entries.<slug>.apiKey` convenience.

### 1.4 Config Update Mechanism (`openclaw.json`)

OpenClaw loads per-skill entries from `skills.entries["<slug>"]`:

```json5
{
  "skills": {
    "entries": {
      "evercontent": {
        "enabled": true,
        "env": {
          "EVERCONTENT_API_KEY": "<resolved-from-vault>"
        },
        "config": {
          "baseUrl": "https://app.evercontent.com",
          "allowedProjectIds": ["project_456"],
          "canPublish": false
        }
      }
    }
  }
}
```

**Update process (same-machine):**

1. Read `~/.openclaw/openclaw.json` (JSON5 tolerant via `json5` or `configstore`).
2. Merge the skill entry into `skills.entries["<slug>"]`:
   - `enabled`: from agent-skill assignment status.
   - `env`: resolved secrets (see §5).
   - `config`: merged from the assignment config (crewcmd `agent_skills.config`), respecting `additionalProperties` in the schema.
3. Write back atomically (write to `.tmp`, rename).
4. Do **not** create a new config entry if the skill already exists with matching values — skip silently.

### 1.5 Sync Function

```typescript
// src/lib/sync-skill-to-openclaw.ts

interface SyncSkillOptions {
  skillId: string;
  agentId: string;        // OpenClaw agent ID
  companyId: string;
  dryRun?: boolean;
}

interface SyncResult {
  success: boolean;
  skillPath: string;
  configPath: string;
  checksum: string;
  errors: string[];
}

export async function syncSkillToOpenClaw(opts: SyncSkillOptions): Promise<SyncResult>
```

### 1.6 When Sync Triggers

- Skill assigned/unassigned to an agent (via UI)
- Skill config updated (assignment config change)
- Skill content updated (e.g., marketplace version update)
- Agent created (push all assigned skills)
- Manual re-sync button ("Push to OpenClaw")

---

## 2. v2 — Remote OpenClaw Sync

Three approaches evaluated. The OpenClaw runs on a different machine (VPS, another LAN host, etc.), so CrewCMD cannot write directly to the filesystem.

### Option A: Gateway Chat API

**How it works:** CrewCMD connects to the OpenClaw Gateway via its existing RPC/chat interface, sends a system message containing the skill content, and asks the agent to write it to its workspace.

**Pros:**
- Uses existing OpenClaw infrastructure (GatewayClient already exists in codebase — see `push-skill-to-runtime.ts`)
- No additional ports, keys, or infrastructure
- Works through the same auth/device identity flow already used for CrewCmd management skill pushes

**Cons:**
- **Relies on the LLM to write files correctly** — fragile, non-deterministic
- No atomic writes — the agent could partially write or corrupt the file
- Round-trip latency (agent must process the message, understand it, act)
- Cannot update `openclaw.json` config reliably (the agent would have to edit JSON)
- No guaranteed delivery or retry semantics
- Security concern: a system prompt could be interpreted differently by different models
- The skill file watcher might pick up the file mid-write

**Verdict:** ❌ **Rejected** — too unreliable for infrastructure-level operations. The existing `push-skill-to-runtime.ts` uses this as a fallback and marks it as "Strategy 2" for a reason.

### Option B: SSH-Based Sync

**How it works:** CrewCMD SSHs into the remote machine and writes skill files + config directly, mirroring the v1 same-machine approach.

**Pros:**
- Deterministic filesystem writes (no LLM intermediary)
- Atomic writes possible (write to `.tmp`, `mv`)
- Can read and update `openclaw.json` directly for config/env injection
- Verifiable (read back written files, check checksums)
- Full rollback support (restore from backup or `.crewcmd-meta.json`)
- SSH key-based auth is standard operational practice for VPS

**Cons:**
- Requires SSH access to the OpenClaw machine
- SSH credentials must be stored and managed in CrewCMD (vault)
- Network dependency (SSH connection must succeed)
- Adds SSH as an operational dependency for the platform

**Verdict:** ⭐ **Winner** — deterministic, verifiable, supports rollback, matches operational norms for remote machine management.

### Option C: Pull-Based (OpenClaw polls CrewCMD)

**How it works:** OpenClaw crewcmd-management skill periodically polls a CrewCMD API endpoint to check for skill updates, then writes them locally.

**Pros:**
- No inbound access needed to the OpenClaw machine
- OpenClaw machine controls the timing of updates
- No SSH credential management in CrewCMD

**Cons:**
- **Major:** OpenClaw skills cannot contain arbitrary Node.js code — they're markdown instruction files. A skill cannot "poll an API and write files" by itself.
- Would need a custom tool/plugin, which goes beyond the skill spec
- Poll interval trade-off (stale between polls vs. unnecessary requests)
- The crewcmd-management skill currently has this pattern but it's specifically implemented as a Node.js tool, not as a skill. Adding generic skill sync to it would bloat the skill and couple it to the sync protocol.
- Config updates (`openclaw.json`) still need to be written by code, not by a skill instruction file

**Verdict:** ❌ **Rejected** — architecturally mismatched with the AgentSkills spec. Skills don't execute code; they instruct the LLM.

### Recommended Approach: SSH-Based Sync

**Architecture:**

```
┌─────────────┐      SSH (key auth)      ┌──────────────────┐
│   CrewCMD   │ ────────────────────────► │  OpenClaw (VPS)  │
│             │                          │                  │
│  • Validate │    writes:                │  • ~/.openclaw/  │
│  • Resolve  │    - skills/<slug>/       │    workspace-<id>│
│    secrets  │      SKILL.md             │    skills/<slug>/│
│  • Resolve  │    - openclaw.json        │  • ~/.openclaw/  │
│    host     │    (merge skill config)    │    openclaw.json │
│  • SSH exec │    - .crewcmd-meta.json   │                  │
│    commands │                           │                  │
└─────────────┘                          └──────────────────┘
```

**Prerequisites for remote sync:**

The runtime record in CrewCMD (`companyRuntimes`) needs additional metadata:

```json
{
  "sshHost": "1.2.3.4",
  "sshPort": 22,
  "sshUser": "openclaw",
  "sshKeyRef": { "name": "openclaw-vps-ssh-key" }
}
```

The SSH key is stored in CrewCMD's secrets vault and used at sync time.

---

## 3. API Design

Endpoints added to CrewCMD for skill sync management:

### `POST /api/skills/:skillId/sync`

Trigger a sync of a specific skill to its assigned agents.

```json
// Request (optional)
{
  "agentIds": ["agent-1", "agent-2"],   // optional; default: all assigned agents
  "dryRun": false
}

// Response 200
{
  "results": [
    {
      "agentId": "agent-1",
      "status": "success",
      "skillPath": "~/.openclaw/workspace-agent-1/skills/evercontent/SKILL.md",
      "checksum": "sha256:abc123",
      "syncedAt": "2026-04-09T16:00:00.000Z"
    },
    {
      "agentId": "agent-2",
      "status": "error",
      "error": "SSH connection refused"
    }
  ]
}
```

### `POST /api/agents/:agentId/sync-all-skills`

Bulk sync all skills assigned to an agent.

```json
// Response 200
{
  "agentId": "agent-1",
  "totalSkills": 5,
  "synced": 4,
  "failed": 1,
  "results": [...]
}
```

### `GET /api/skills/:skillId/sync-status`

Check the last sync status for a skill.

```json
// Response 200
{
  "skillId": "abc123",
  "lastSyncAt": "2026-04-09T16:00:00.000Z",
  "lastSyncBy": "user-456",
  "targetAgents": ["agent-1", "agent-2"],
  "agentStatuses": [
    {
      "agentId": "agent-1",
      "status": "synced",
      "lastChecksum": "sha256:abc123",
      "lastSyncAt": "2026-04-09T16:00:00.000Z"
    }
  ]
}
```

### `POST /api/skills/:skillId/rollback`

Restore the previous version of a skill on target agents.

```json
// Request
{
  "agentIds": ["agent-1"]
}

// Response 200
{
  "results": [...]
}
```

---

## 4. Data Flow

```
┌──────────────┐
│ User assigns  │
│ skill to agent│
│ via CrewCMD UI│
└───────┬──────┘
        │
        ▼
┌──────────────────┐     ┌─────────────────┐
│ 1. Validate config│    │ Check agent-     │
│ against skill's  │◄────skills config     │
│ configSchema     │     in DB             │
└───────┬──────────┘
        │ config valid
        ▼
┌──────────────────┐
│ 2. Resolve secrets│
│ from vault       │
│ (name → value)   │
└───────┬──────────┘
        │ secrets resolved
        ▼
┌──────────────────────────┐
│ 3. Generate SKILL.md     │
│   (+ metadata frontmatter│
│    + .crewcmd-meta.json)  │
└───────┬──────────────────┘
        │
        ▼
┌──────────────────────────┐
│ 4. Sync to target        │
│                          │
│ v1 (same-machine):       │
│  - Write file to fs      │
│  - Merge openclaw.json   │
│                          │
│ v2 (remote):             │
│  - SSH to remote host    │
│  - Write file via scp/cat│
│  - Update openclaw.json  │
│    via remote sed/python │
└───────┬──────────────────┘
        │
        ▼
┌──────────────────────────┐
│ 5. Verify write          │
│  - Read back file        │
│  - Compare SHA-256       │
│  - Log result            │
└───────┬──────────────────┘
        │ verified
        ▼
┌──────────────────────────┐
│ 6. Hot-reload            │
│                          │
│ Same-machine:            │
│  - File watcher picks up │
│    change automatically  │
│    (debounce ~250ms)     │
│                          │
│ Remote:                  │
│  - File watcher picks up │
│    (same as local since  │
│    the file is written   │
│    on the OpenClaw host) │
│  - Next new session gets │
│    the updated skill     │
│  - Existing sessions get │
│    refreshed on next turn│
│    (skills watcher)      │
└──────────────────────────┘
```

### 4.1 Config Validation

```typescript
// Validate assignment config against skill schema
function validateConfig(schema: ConfigSchema, config: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
} {
  // Use standard JSON Schema validation (ajv)
  // Check required fields, types, enums
  // Return clear error messages per field
}
```

Validation blocks sync if config is invalid. Error messages are returned to the UI for the user to fix.

### 4.2 File Write (same-machine)

```typescript
async function writeSkillFile(skillPath: string, content: string): Promise<void> {
  const tmpPath = `${skillPath}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, skillPath); // atomic on POSIX
}
```

### 4.3 File Write (remote via SSH)

```typescript
async function writeSkillFileRemote(
  sshConfig: SSHConfig,
  skillPath: string,
  content: string
): Promise<void> {
  const encoded = Buffer.from(content).toString('base64');
  const tmpPath = `${skillPath}.tmp`;
  
  // Write via base64-encoded cat (handles all content safely)
  await ssh.exec(
    `mkdir -p $(dirname ${skillPath}) && ` +
    `echo "${encoded}" | base64 -d > ${tmpPath} && ` +
    `mv ${tmpPath} ${skillPath}`
  );
}
```

### 4.4 Config Merge (openclaw.json)

```typescript
async function mergeSkillConfig(
  configPath: string,     // SSH or local
  skillSlug: string,
  entry: SkillEntryConfig
): Promise<void> {
  // Read current config
  // Merge skills.entries[skillSlug] = entry
  // If entry already exists, deep-merge:
  //   - enabled: overwrite
  //   - env: merge new keys, keep existing
  //   - config: merge new keys, keep existing
  // Write atomically
}
```

---

## 5. Secrets Resolution

### 5.1 CrewCMD Vault → OpenClaw Env Mapping

CrewCMD stores secrets in its vault (company-scoped). Skill configs reference vault entries via `secretRef`:

```json
{
  "secretRef": { "name": "evercontent-api-key" }
}
```

**Resolution flow:**

1. Look up the skill's `configSchema` to find fields with `secretRef` properties.
2. For each `secretRef.name`, resolve the actual value from the CrewCMD secrets vault.
3. Determine the env var name:
   - Use `metadata.openclaw.primaryEnv` from the SKILL.md if set (e.g., `EVERCONTENT_API_KEY`)
   - Otherwise, derive from skill slug: `EVERCONTENT_API_KEY`, `CLUTCUTCUT_API_KEY`, etc.
4. Inject into `skills.entries["<slug>"].env` in `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "evercontent": {
        "enabled": true,
        "env": {
          "EVERCONTENT_API_KEY": "<resolved-value>"
        }
      }
    }
  }
}
```

### 5.2 Security Considerations

- Secrets in `openclaw.json` are plaintext on disk — this matches OpenClaw's existing model for `skills.entries.<slug>.env`
- The `apiKey` field supports SecretRef objects (`{ source, provider, id }`) for integration with OpenClaw's secret providers, but this requires OpenClaw to be configured with a secret provider. For v1, plaintext `env` injection is sufficient.
- SSH connections for remote sync use key-based auth, not passwords
- SSH keys are stored in CrewCMD's vault, not in code
- Audit log entries for secret resolution: who triggered sync, which secrets were resolved, to which agent

### 5.3 Secret Rotation

If a secret changes in the CrewCMD vault:
1. Trigger a re-sync of all skills referencing that secret
2. Update `openclaw.json` on target machines
3. OpenClaw's skills watcher picks up the config change
4. Next agent turn uses the new secret

---

## 6. Error Handling

### 6.1 Error Categories and Responses

| Error | Category | Response | User Impact |
|---|---|---|---|
| Config validation failure | Pre-sync | Block sync, return field-level errors | User must fix config in UI |
| Permission denied (same-machine) | Filesystem | Log error, alert admin | Skill not synced; admin must fix permissions on `~/.openclaw/` |
| Permission denied (remote) | SSH | Log error, alert admin | Check SSH user permissions, key validity |
| Remote unreachable (SSH timeout) | Network | Retry with exponential backoff (3 attempts: 5s, 15s, 45s), then fail | Alert user; sync marked as "failed"; retry button available |
| Disk full on target | Filesystem | Fail immediately | Alert admin; clean up disk |
| openclaw.json is corrupted | Filesystem | Fail, do not overwrite; alert admin | Admin must restore openclaw.json from backup |
| Secret not found in vault | Pre-sync | Block sync, return which secret is missing | User must add the secret to vault |
| Agent workspace doesn't exist | Filesystem | Fail, alert user | Agent workspace must be created first (`openclaw agents add ...`) |
| Concurrent sync collision | Concurrency | File lock via `.sync-lock` file in skill directory; wait up to 10s, then fail | "Another sync is in progress" — user retries |

### 6.2 Retry Policy

```
Max retries: 3
Backoff: exponential (5s, 15s, 45s)
Retry only on: transient network errors (ECONNREFUSED, ETIMEDOUT, SSH_TIMEOUT)
Never retry on: permission denied, validation failure, disk full
```

### 6.3 Error Logging

All sync errors are logged to the `sync_events` table:

```typescript
interface SyncEvent {
  id: string;
  skillId: string;
  agentId: string;
  status: 'success' | 'error';
  errorType?: string;       // 'config_validation' | 'ssh_timeout' | 'permission_denied' | ...
  errorMessage?: string;
  attempt: number;
  createdAt: Date;
}
```

### 6.4 Concurrent Sync Protection

Use a `.sync-lock` file within the skill directory:

```typescript
async function acquireLock(skillPath: string): Promise<boolean> {
  const lockPath = path.join(skillPath, '.sync-lock');
  try {
    await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' }); // fail if exists
    return true;
  } catch {
    // Lock exists — check if stale (> 5 min old)
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
      await fs.unlink(lockPath);
      return await acquireLock(skillPath);
    }
    return false;
  }
}
```

---

## 7. Rollback Plan

### 7.1 Strategy: Shadow Backup + Atomic Restore

Before writing any skill file or modifying `openclaw.json`, CrewCMD creates a backup:

**Skill file backup:**
```
~/.openclaw/workspace-<agentId>/skills/<skill-slug>/backups/
├── 2026-04-09T15:00:00.000Z-SKILL.md
├── 2026-04-09T15:00:00.000Z-crewcmd-meta.json
```

**OpenClaw config backup:**
```
~/.openclaw/openclaw.json.bak.<timestamp>
```

### 7.2 Rollbar (`.crewcmd-meta.json`) Tracks Previous Checksum

The `.crewcmd-meta.json` file stores the previous version's checksum:

```json
{
  "source": "crewcmd",
  "version": "0.1.0",
  "syncedAt": "2026-04-09T16:00:00.000Z",
  "previousChecksum": "sha256:def456...",
  "backupPath": "backups/2026-04-09T15:00:00.000Z-SKILL.md"
}
```

### 7.3 Rollback Process

```typescript
async function rollbackSkill(opts: {
  skillId: string;
  agentId: string;
}): Promise<RollbackResult> {
  // 1. Load .crewcmd-meta.json from the skill directory
  // 2. Read backupPath or recreate from previousChecksum
  // 3. Atomic write: backup current → restore from backup
  // 4. Restore openclaw.json from timestamped backup
  // 5. Update .crewcmd-meta.json with new state
  // 6. Log rollback event
}
```

### 7.4 Maximum Rollback Depth

- Keep last **3 backups** per skill per agent
- Oldest backup is pruned when a 4th is created
- Backups are stored locally (same machine as the skill) — no network dependency for rollback

---

## 8. RBAC Alignment

### 8.1 CrewCMD Roles

| Role | Can assign skills? | Can sync? | Can rollback? | Can resolve secrets? |
|---|---|---|---|---|
| Owner | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Admin | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Editor | ✅ Assigned agents only | ✅ Assigned agents only | ✅ Own syncs only | ❌ (read-only access to secret names) |
| Viewer | ❌ | ❌ | ❌ | ❌ |

### 8.2 Enforcement Points

1. **UI layer:** Hide/disable skill assignment buttons for roles that lack permission
2. **API layer:** Every sync endpoint checks `checkUserPermission(userId, companyId, 'skills:sync')`
3. **Agent scope:** Editors can only assign/sync to agents they have access to (agent-level ACL in `agent_skills`)

### 8.3 Secret Access

- Secret **values** are never exposed to Editor/Viewer roles
- Secret **names/references** are visible to Editors (so they can see which secret a skill needs)
- Only Owner/Admin can create, edit, or rotate secrets
- During sync, the sync service resolves secrets using a service-level vault access token — secret values are never returned to the frontend

### 8.4 Audit Trail

Every skill assignment, config change, sync, and rollback is logged:

```typescript
interface AuditLog {
  id: string;
  companyId: string;
  userId: string;
  action: 'skill_assigned' | 'skill_revoked' | 'skill_config_updated' |
          'sync_triggered' | 'sync_completed' | 'sync_failed' |
          'rollback_triggered' | 'rollback_completed' |
          'secret_resolved';
  resourceId: string;     // skillId or agentId
  details: Record<string, unknown>;
  createdAt: Date;
}
```

---

## 9. Implementation Plan

### Phase 1: Same-Machine Sync (v1)
- [ ] `src/lib/sync-skill-to-openclaw.ts` — core sync function
- [ ] `src/lib/resolve-host.ts` — detect same-machine vs remote
- [ ] `src/lib/generate-skill-md.ts` — generate SKILL.md with proper frontmatter
- [ ] `src/lib/resolve-secrets.ts` — vault → env var resolution
- [ ] `src/lib/config-merge.ts` — openclaw.json merge utility
- [ ] `POST /api/skills/:skillId/sync` — sync trigger endpoint
- [ ] `POST /api/agents/:agentId/sync-all-skills` — bulk sync endpoint
- [ ] Sync event logging (`SyncEvent` table)

### Phase 2: Remote Sync (v2)
- [ ] `src/lib/ssh-client.ts` — SSH connection pool
- [ ] `src/lib/sync-skill-remote.ts` — remote file write + config update
- [ ] `GET /api/skills/:skillId/sync-status` — status endpoint
- [ ] SSH key storage in secrets vault
- [ ] Runtime metadata fields for SSH config

### Phase 3: Rollback + Monitoring
- [ ] Backup mechanism + `POST /api/skills/:skillId/rollback`
- [ ] Retry logic with exponential backoff
- [ ] Concurrent sync protection (file locks)
- [ ] RBAC middleware for all sync endpoints

---

## 10. Open Questions

1. **OpenClaw config format:** `openclaw.json` supports JSON5 (comments, trailing commas). Should we use a proper JSON5 parser (`json5` npm package) or stick to strict JSON for our writes to avoid corrupting comments? **Recommendation:** Use `json5` for parsing, strict JSON for writing (preserve comments is not critical for programmatic updates — if needed, strip-and-rewrite with a header comment).

2. **Shared skills:** Should SaaS skills (EverContent, ClutchCut) be installed as shared skills (`~/.openclaw/skills/`) so all agents can see them, then gated via `skills.entries`? Or per-agent per-agent in each workspace? **Recommendation:** Per-agent in workspace skills. Shared skills are visible to ALL agents and can't be gated per-agent at the filesystem level — gating only works via `skills.entries.<slug>.enabled`, which is harder to manage and debug.

3. **Skill updates from marketplace:** When a skill version updates in CrewHub, should it auto-sync to all assigned agents, or require manual approval? **Recommendation:** Manual approval via UI (show diff: old vs new SKILL.md, changed config fields). Auto-sync risks breaking agents with incompatible skill versions.

4. **Multiple runtimes per company:** A company could have multiple OpenClaw runtimes. Should a skill assignment sync to all of them, or is it runtime-scoped? **Recommendation:** Runtime-scoped. The `agent_skills` table already links to agents, and agents are on a specific runtime. Sync follows the assignment.
