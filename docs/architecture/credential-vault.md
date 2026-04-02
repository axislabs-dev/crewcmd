# Credential Vault & Skill Secrets Architecture

> Status: Planning Spec
> Created: 2026-04-02
> Author: Neo + Roger (voice session)

## Problem

Skills need API keys and tokens to interact with external services (CRMs, email providers, social platforms). These secrets must never enter the LLM context window because:

1. Once in context, secrets are sent to third-party LLM providers (Anthropic, OpenAI, etc.)
2. No visibility into whether they're logged, cached, or retained
3. No mechanism to revoke exposure after the fact
4. Chat history stores conversation in the DB, so secrets pasted in chat persist

## Core Principles

1. **Secrets never enter LLM context.** Injected as env vars at the OS/runtime level only.
2. **Runtime-agnostic.** Must work across OpenClaw, CrewAI, LangGraph, NanoClaw, and future runtimes.
3. **Multi-tenant.** Credentials scoped per company, encrypted at rest.
4. **Skills declare dependencies.** Manifest lists required credentials. CrewCmd validates before dispatch.
5. **Agents never ask for credentials.** System prompt rule enforced across all agents.
6. **Chat scrubbing as safety net.** Pattern-match API key formats and redact before storage.

## Design

### 1. Skill Manifest

Each SKILL.md includes a frontmatter block declaring required credentials:

```yaml
---
name: hubspot-lead-management
requires:
  - key: HUBSPOT_API_KEY
    label: "HubSpot Private App Token"
    help: "Found in HubSpot > Settings > Integrations > Private Apps"
    type: api_key
  - key: HUBSPOT_PORTAL_ID
    label: "HubSpot Portal ID"
    help: "Found in Settings > Account"
    type: identifier
---
```

When a skill is installed, CrewCmd reads this manifest and prompts the user to fill in missing credentials through the Settings UI.

### 2. Database Schema

```sql
-- Company-scoped encrypted credential storage
CREATE TABLE skill_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,           -- e.g. "hubspot-lead-management"
  credential_key TEXT NOT NULL,     -- e.g. "HUBSPOT_API_KEY"
  encrypted_value TEXT NOT NULL,    -- AES-256-GCM encrypted
  iv TEXT NOT NULL,                 -- initialization vector
  label TEXT,                       -- human-readable label from manifest
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,                  -- user who set it
  UNIQUE(company_id, skill_id, credential_key)
);

-- Encryption key management
CREATE TABLE encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL DEFAULT 1,
  encrypted_key TEXT NOT NULL,      -- master key encrypted with app-level secret
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  UNIQUE(company_id, key_version)
);
```

### 3. Settings UI (Credentials Only Enter Here)

- Located under Settings > Integrations or Settings > Credentials
- Password-masked input fields
- Click-to-reveal for viewing
- Per-skill grouping: "HubSpot Lead Management needs 2 credentials"
- Status indicators: configured / missing / expired
- Only org owner/admin can view or modify
- Never accessible through chat, agent commands, or API without admin auth

### 4. Runtime Adapter Injection Layer

Each runtime type has an adapter that knows how to inject credentials:

```typescript
interface RuntimeCredentialAdapter {
  // Inject credentials into the runtime before task dispatch
  inject(
    runtimeConfig: RuntimeConfig,
    credentials: Map<string, string>  // key -> decrypted value
  ): Promise<void>;
}

// OpenClaw adapter: writes to gateway env config
class OpenClawAdapter implements RuntimeCredentialAdapter {
  async inject(config, credentials) {
    // Set env vars via gateway RPC or config write
  }
}

// Generic adapter: sets process env vars before spawn
class ProcessAdapter implements RuntimeCredentialAdapter {
  async inject(config, credentials) {
    // Merge into process.env for child process
  }
}
```

Flow at dispatch time:
1. CrewCmd receives task dispatch for agent with skill X
2. Looks up skill X's required credentials for this company
3. Decrypts them from the vault
4. Passes to the appropriate runtime adapter
5. Adapter injects as env vars before agent process starts
6. Agent's CLI tools read env vars natively
7. LLM never sees the raw values

### 5. Chat Scrubber

Safety net for accidental exposure. Runs on all chat messages before storage:

```typescript
const KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI-style
  /xoxb-[a-zA-Z0-9-]+/g,            // Slack bot tokens
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub PATs
  /[a-f0-9]{32,64}/g,               // Generic hex keys (with length filter)
  /[A-Za-z0-9+/]{40,}={0,2}/g,      // Base64 keys
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, // Bearer tokens
];

function scrubMessage(text: string): string {
  let scrubbed = text;
  for (const pattern of KEY_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}
```

### 6. Agent System Prompt Rule

All agents get this in their base system prompt:

```
NEVER ask the user for API keys, tokens, passwords, or any credentials.
If a task requires credentials that are not configured, respond:
"This task requires [credential name]. Please add it in Settings > Credentials."
Do not accept credentials pasted in chat.
```

## Encryption Architecture

- App-level master secret derived from AUTH_SECRET (auto-generated, see zero-config spec)
- Per-company encryption keys stored in `encryption_keys` table
- AES-256-GCM for credential encryption
- Key rotation support via `key_version`
- Decryption happens in-memory only, never written to disk unencrypted

## Migration Path

### Phase 1 (MVP)
- Skill manifest with `requires` block
- `skill_credentials` table with basic AES encryption
- Settings UI for credential entry
- OpenClaw runtime adapter (env var injection)
- Chat scrubber

### Phase 2 (Multi-runtime)
- Additional runtime adapters (CrewAI, LangGraph, etc.)
- OAuth flows for major integrations (Google, HubSpot, Salesforce)
- Credential health checks (test if key is still valid)

### Phase 3 (Enterprise)
- External vault integration (HashiCorp Vault, AWS Secrets Manager)
- Audit log for credential access
- Key rotation policies
- Per-agent credential scoping (not all agents see all keys)

## Open Questions

- Should credentials be scoped per-agent or per-company? Per-company is simpler, per-agent is more secure.
- How to handle OAuth refresh tokens that expire and need rotation?
- Should CrewCmd support importing credentials from existing OpenClaw SecretRef configs?
