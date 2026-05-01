# Model Profile Domain Proposal

## Goal

Persist reusable model profiles without coupling model browsing to agent
assignment writes or runtime config mutation.

## Proposed Domain

### `model_profiles`

Stores named profile definitions that can be owned by a company or user.

Suggested fields:

- `id`
- `owner_type`: `user` or `company`
- `owner_user_id`
- `owner_company_id`
- `name`
- `slug`
- `description`
- `profile_key`: optional built-in key such as `developer_primary`
- `provider_preferences`: ordered string array
- `primary_model`
- `fallback_models`
- `created_at`
- `updated_at`

Constraints:

- exactly one owner scope is required
- `slug` is unique per owner scope
- `provider_preferences`, `primary_model`, and `fallback_models` are advisory
  until assignment writes are explicitly enabled

### `company_model_defaults`

Stores company-level default profile or model selection.

Suggested fields:

- `id`
- `company_id`
- `model_profile_id`
- `model`
- `created_at`
- `updated_at`

Constraints:

- one default row per company
- either `model_profile_id` or `model` may be set, but not both
- company defaults never overwrite explicit agent overrides

### Agent Overrides

Agent-level overrides should stay on the existing agent domain unless a later
schema review decides to split them into a dedicated assignment table.

Resolution order:

1. agent override
2. company default
3. runtime default

## Write Boundaries

The first persistence PR should only create and read model profile records.

Do not include:

- runtime `config.patch` calls
- agent model override writes
- company default writes
- automatic sync to OpenClaw
- migrations that backfill existing agents

Those belong in follow-up PRs after the read domain is reviewed.

## API Shape

Read-only first:

- `GET /api/models/profiles`
- `GET /api/models/profiles/:id`

Write endpoints after approval:

- `POST /api/models/profiles`
- `PATCH /api/models/profiles/:id`
- `DELETE /api/models/profiles/:id`

Assignment endpoints after separate approval:

- `PUT /api/companies/:id/model-default`
- `PUT /api/agents/:callsign/model-override`

## Verification

Minimum verification for the first persistence PR:

```bash
pnpm typecheck
pnpm test src/lib/model-profiles.test.ts
git diff --check
```

Add route tests for any API route added.

## Approval Needed

Approve before implementation:

- schema names and ownership fields
- whether company defaults can reference either a profile or raw model
- whether agent overrides remain on `agents` or move into an assignment table
- whether deletes should be soft deletes before assignment writes exist
