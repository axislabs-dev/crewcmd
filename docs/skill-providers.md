# Skill Provider Integration Design

## Quick Start: Enable ClawHub Skills

ClawHub marketplace skills require one env variable to enable live browsing:

```bash
# .env or .env.local
CREWCMD_CLAWHUB_CATALOG_ENABLED="true"
```

Without this, only hardcoded `FALLBACK_SKILLS` appear. The `.env.example` file now includes this enabled by default.

## Purpose

CrewCMD should support external skill providers without making every provider a special case in the Skills UI or in `/api/skills/import`. The first provider to design for is ClawHub, because OpenClaw already has native ClawHub search, detail, install, and update support through the gateway.

CrewCMD now keeps the browse/import provider contract while using OpenClaw's native ClawHub installer during agent sync. A ClawHub marketplace import creates a CrewCMD skill record with provider metadata; when that skill is assigned to an OpenClaw-backed agent, CrewCMD calls gateway `skills.install` before patching gateway skill config. The gateway owns the workspace `skills/` directory and `.clawhub/lock.json` semantics.

## Current CrewCMD Skill Flow

Current CrewCMD skill discovery and import are simple:

- `/api/skills/browse` returns marketplace/provider skills. When a workspace runtime is available it uses OpenClaw gateway `skills.search` plus `skills.status` for native ClawHub catalog/install state, then falls back to the HTTP catalog and hardcoded skills.
- `/api/skills/import` accepts manual provider payloads for legacy sources. For `{ provider/source: "clawhub", slug, version?, runtimeId? }`, it first calls OpenClaw gateway `skills.install`, preserving native `.clawhub/lock.json` semantics, then creates or updates a `skills` row in the selected workspace.
- `src/lib/skill-config-form.ts` renders forms from `skills.metadata.configSchema`.
- `src/lib/sync-skill-to-openclaw.ts` turns a CrewCMD skill row plus assignment config into OpenClaw gateway `skills.update` config.

That means CrewCMD treats marketplace import as "store this skill record in our DB" first. Native OpenClaw installation happens when the skill is assigned/synced to an OpenClaw-backed agent; the gateway installer validates the ClawHub slug/version, writes the skill files, and maintains origin/lock metadata.

## OpenClaw Native Gateway Surface

Local OpenClaw source and docs show the native gateway path CrewCMD should use:

- `skills.search` with `operator.read` searches ClawHub.
- `skills.detail` with `operator.read` fetches ClawHub detail metadata.
- `skills.install` with `operator.admin` supports `{ source: "clawhub", slug, version?, force? }` and installs into the default agent workspace `skills/` directory.
- `skills.update` with `operator.admin` supports `{ source: "clawhub", slug?, all? }` and updates tracked ClawHub installs from the workspace `.clawhub/lock.json`.

OpenClaw's ClawHub client uses `https://clawhub.ai` by default and supports:

- `GET /api/v1/search?q=...&limit=...`
- `GET /api/v1/skills`
- `GET /api/v1/skills/:slug`
- `GET /api/v1/download?slug=...&version=...`

Auth/token discovery is native to OpenClaw: `OPENCLAW_CLAWHUB_TOKEN`, `CLAWHUB_TOKEN`, `CLAWHUB_AUTH_TOKEN`, then local ClawHub config files including macOS Application Support and XDG config. OpenClaw also supports `OPENCLAW_CLAWHUB_URL` / `CLAWHUB_URL` for registry URL override.

## Decision: Provider Endpoints, Not Provider-Specific Routes

CrewCMD should extend the existing browse/import concepts with a provider abstraction, not add `/api/clawhub/*` routes.

Recommended API shape:

- `GET /api/skills/browse?provider=clawhub&query=&runtimeId=&limit=`
- `GET /api/skills/browse/:provider/:slug` or `GET /api/skills/detail?provider=clawhub&slug=&runtimeId=`
- `POST /api/skills/import` with `{ provider: "clawhub", slug, version?, runtimeId, workspaceId }`
- `POST /api/skills/:id/check-updates` or a future provider update endpoint for installed skills

Reasoning:

- The UI should show skills as a provider catalog, not as ClawHub-only screens.
- ClawHub is a provider implementation behind the same discovery/import workflow as future GitHub/manual/private registries.
- The import route can preserve its current manual payload behavior while adding a validated provider branch later.
- The gateway should own ClawHub installation side effects because it already validates slugs, downloads archives, extracts safely, records `.clawhub/origin.json`, maintains `.clawhub/lock.json`, and supports tracked updates.

## Provider Contract

`src/lib/skill-provider-types.ts` defines the shared vocabulary:

- list skills
- get skill detail
- import skill
- check updates
- source metadata
- trust metadata
- update status
- assets/scripts support

The ClawHub provider is now wired into browse/import runtime behavior; the same type vocabulary is still used to keep future providers consistent.

## ClawHub Provider Responsibilities

The ClawHub provider should:

1. List skills through gateway `skills.search` when a runtime is selected.
2. Get detail through gateway `skills.detail`.
3. Import through gateway `skills.install` only after CrewCMD RBAC allows the action.
4. Check updates through gateway `skills.update` dry-run support if OpenClaw adds it, or by reading status/origin metadata when exposed by gateway status.
5. Normalize ClawHub source metadata into CrewCMD skill metadata.
6. Preserve ClawHub trust metadata instead of flattening it into markdown.
7. Surface install requirements, config schema, assets, and scripts as metadata before execution.

CrewCMD should not ask users to paste raw skill content for ClawHub installs. Pasting remains a manual/custom provider flow. ClawHub is a registry-backed install where the gateway receives `{ source: "clawhub", slug, version? }`.

## Metadata Shape

CrewCMD skill rows imported from a provider should store enough metadata to audit origin and updates:

```json
{
  "provider": {
    "id": "clawhub",
    "skillId": "calendar",
    "registryUrl": "https://clawhub.ai",
    "sourceUrl": "https://clawhub.ai/skills/calendar",
    "ownerHandle": "publisher",
    "version": "1.2.3",
    "integrity": "sha256-...",
    "installedAt": "2026-04-28T00:00:00.000Z"
  },
  "trust": {
    "level": "community",
    "isOfficial": false,
    "verificationTier": "reviewed",
    "scanStatus": "passed",
    "sourceRepo": "https://github.com/org/repo",
    "sourceCommit": "abc123",
    "hasProvenance": true,
    "warnings": []
  },
  "update": {
    "status": "current",
    "currentVersion": "1.2.3",
    "latestVersion": "1.2.3",
    "checkedAt": "2026-04-28T00:00:00.000Z"
  },
  "configSchema": {},
  "assets": [
    {
      "path": "SKILL.md",
      "kind": "skill-md",
      "sha256": "..."
    }
  ],
  "supportsScripts": false
}
```

Trust levels:

- `official`: OpenClaw/ClawHub official publisher or package.
- `verified`: source/provenance/scan metadata meets CrewCMD policy.
- `community`: normal public marketplace skill.
- `private`: private registry/user-scoped package.
- `unknown`: incomplete metadata.
- `untrusted`: blocked or failed scan/provenance policy.

Update statuses:

- `not-installed`, `current`, `update-available`, `pinned`, `blocked`, `error`, `unknown`.

## Security And Trust Model

CrewCMD must treat skill installation as a privileged supply-chain operation.

Required controls:

- Server-side RBAC must run before any gateway `operator.admin` skill RPC.
- ClawHub install/update must be workspace owner or company owner/admin only. Team members may browse and view detail, but must not install/update.
- Personal workspace install is allowed only for the personal workspace owner.
- Company workspace install is allowed only for company `owner` or `admin`; if product policy tightens to owner-only, this check should be one helper change.
- Gateway device credentials and ClawHub tokens must never be sent to the browser.
- CrewCMD should display trust/source metadata before install and require explicit confirmation for `community`, `unknown`, private registries, scripts, or installer actions.
- Auto-update should not be enabled for ClawHub skills by default. Update should show old/new version and trust deltas before applying.
- Skills with scripts/assets should be visible as such before install. Script execution should use OpenClaw's gateway installer/dangerous-code scanner path, not browser-provided content.
- CrewCMD should never accept browser-supplied ClawHub `content` as authoritative for provider imports. Content comes from gateway/provider detail or post-install status.

## RBAC Integration

Add a small authorization helper before implementing import:

- `canBrowseSkillProviders`: any authenticated user with workspace read access.
- `canInstallSkillProvider`: personal workspace owner, company owner/admin.
- `canUpdateProviderSkill`: same as install.
- `canAssignInstalledSkill`: existing agent ownership/visibility policy.

This separates "install a skill into the workspace" from "assign an installed skill to an agent." A member may be able to assign an already installed skill to agents they can manage, but they should not install new provider code/content into the workspace.

Gateway scope alignment:

- Browse/detail maps to `operator.read`.
- Install/update maps to `operator.admin`.
- CrewCMD must not expose a browser endpoint that forwards arbitrary gateway method names or raw admin params.

## UX Flow

Recommended flow:

1. User opens Skills.
2. CrewCMD lists installed skills and provider catalogs.
3. User selects ClawHub and searches.
4. CrewCMD calls the selected runtime gateway `skills.search`.
5. User opens detail.
6. CrewCMD calls gateway `skills.detail` and displays publisher, trust, version, requirements, config schema, assets/scripts, and install destination.
7. If the user has install permission, CrewCMD shows Install. Otherwise it shows "Request owner install" or read-only state.
8. Owner/admin confirms install.
9. CrewCMD calls gateway `skills.install` with `{ source: "clawhub", slug, version? }`.
10. CrewCMD creates or updates a CrewCMD `skills` row with provider metadata and marks it installed.
11. Assignment to agents remains a separate step and uses the existing config form and sync path.

## Implementation Notes

- `src/lib/gateway-client.ts` exposes native skill RPC helpers for `skills.search`, `skills.detail`, `skills.install`, `skills.list`, `skills.update`, and `skills.uninstall`.
- `src/lib/skill-providers/clawhub.ts` normalizes ClawHub catalog entries into CrewCMD marketplace records and preserves provider/trust/update metadata.
- `src/lib/sync-skill-to-openclaw.ts` detects `metadata.provider.id === "clawhub"` and calls `skills.install` with `{ source: "clawhub", slug, version? }` before patching gateway config and enabling the skill.
- OpenClaw remains the source of truth for the installed skill directory and `.clawhub/lock.json`; CrewCMD stores origin metadata and assignment/config state.

## Remaining Follow-Up Work

1. Add stricter provider-install RBAC tests for personal owner, company owner/admin, member, and viewer.
2. Add provider detail/update endpoints and UI for `skills.detail`, `skills.list`, and native `skills.update` apply flows.
3. Add audit events for browse detail, install, update, and blocked RBAC attempts.

## Open Questions

- Should company policy be owner-only for install/update, or owner/admin? This design recommends owner/admin because CrewCMD already treats both as company admin roles, but the helper can enforce owner-only if desired.
- Does OpenClaw expose enough post-install status to let CrewCMD populate exact `integrity`, asset list, and origin metadata without reading files? If not, CrewCMD should store gateway response plus ClawHub detail first, then improve metadata when gateway status adds origin fields.
- Should CrewCMD install into one selected runtime workspace or all runtimes attached to a CrewCMD workspace? This design recommends selected runtime first, then explicit multi-runtime rollout later.
- Should provider import create the CrewCMD DB row before gateway install as a pending record, or only after gateway success? This design recommends after gateway success for v1 to avoid orphaned installed=false records.
