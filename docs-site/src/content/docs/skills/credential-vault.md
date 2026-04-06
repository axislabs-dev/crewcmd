---
title: Credential Vault
description: Securely manage API keys and secrets for agent skills.
---

The Credential Vault manages API keys and secrets that skills need to function — without ever exposing them to LLM context.

## Security Principles

1. **Secrets never enter LLM context** — Credentials are injected as environment variables at the OS/runtime level only
2. **Skill manifests declare dependencies** — Each skill's YAML frontmatter lists required credentials
3. **Company-scoped encryption** — AES-256-GCM encryption, per-company encryption keys
4. **Admin-only access** — Only company admins can view or modify credentials

## How It Works

### Skill Manifests

Skills declare what credentials they need:

```yaml
credentials:
  - name: GITHUB_TOKEN
    type: api_key
    description: GitHub personal access token
    required: true
```

### Credential Storage

Credentials are stored in the `skill_credentials` table:
- Encrypted with AES-256-GCM
- Scoped to a company
- Encryption keys derived from the app-level master secret (`AUTH_SECRET`)

### Runtime Injection

When an agent executes with a skill:
1. The runtime adapter reads required credentials from the vault
2. Decrypts them server-side
3. Injects them as environment variables in the agent's process
4. The LLM never sees the raw credential values

### Safety Net

A **chat scrubber** detects and redacts credential patterns before storing messages — an additional safety layer in case a credential accidentally appears in output.

## Managing Credentials

Go to **Settings > Integrations** to manage credentials:
- Add credentials for installed skills
- Credentials are password-masked by default
- Rotate or revoke credentials at any time

## API

Credentials are managed through the Settings UI for security. There is no direct API for credential values.
