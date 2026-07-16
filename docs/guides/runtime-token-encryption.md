# Runtime Token Encryption and Rotation

CrewCmd encrypts `company_runtimes.auth_token` before it reaches Postgres or
PGlite. Decryption happens only at server-side OpenClaw, Hermes, or linked-agent
execution boundaries. The
ciphertext envelope is versioned, uses AES-256-GCM with a random 96-bit nonce,
and authenticates the key ID and payload.

## Key source

For a zero-config local install, CrewCmd derives a compatibility encryption key
from `AUTH_SECRET`. Production deployments should use a dedicated keyring:

```bash
openssl rand -base64 32
```

Store the generated value in the deployment secret manager, not in Git:

```dotenv
CREWCMD_RUNTIME_TOKEN_KEYS='{"2026-07":"BASE64_32_BYTE_KEY"}'
CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID="2026-07"
```

`CREWCMD_RUNTIME_TOKEN_KEYS` is a JSON object. Each value must decode to exactly
32 bytes. Key IDs may contain letters, numbers, `.`, `_`, and `-`. When the
keyring contains one dedicated key, the active ID may be omitted. When it
contains multiple keys, the active ID is required.

Back up the keyring separately from the database. A database backup without its
keyring cannot recover runtime tokens. Anyone with both can decrypt them, so
apply the same access controls and retention policy to both assets.

## Upgrade existing plaintext rows

Install the new CrewCmd version without starting the application, then:

1. Stop CrewCmd so the token set cannot change during migration.
2. Back up the database and verify the backup is readable.
3. Configure the dedicated keyring. Keep the existing `AUTH_SECRET` available.
4. Run the read-only inventory:

   ```bash
   pnpm runtime-tokens:migrate
   ```

5. Review the counts. The command never prints token values.
6. Apply the migration atomically:

   ```bash
   pnpm runtime-tokens:migrate --apply --yes
   ```

7. Run the dry-run command again. `plaintext`, `rotated`, and `updates` should
   all be zero; `current` should equal the number of configured runtime tokens.
8. Start CrewCmd and test each runtime connection.

The command uses `DATABASE_URL` when present and the configured PGlite data
directory otherwise. PGlite migration refuses to run while another CrewCmd
process owns the database lock. Legacy plaintext remains readable at
server-side execution boundaries so operators can perform a staged upgrade,
but every new API write is encrypted and the dry run continues to report any
row that still needs migration.

## Rotate a key

1. Back up the database and current keyring.
2. Add a new key while retaining every key referenced by current ciphertext:

   ```dotenv
   CREWCMD_RUNTIME_TOKEN_KEYS='{"2026-07":"OLD_BASE64_KEY","2026-10":"NEW_BASE64_KEY"}'
   CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID="2026-10"
   ```

3. Stop CrewCmd.
4. Run the dry run, then `pnpm runtime-tokens:migrate --apply --yes`.
5. Rerun the dry run and test every runtime.
6. Take a new backup paired with the new keyring.
7. Remove the old key only after no rows report `rotated` and the rollback
   retention window has expired.

The migration validates current ciphertext as well as rows that need updates.
Tampering or an unavailable old key aborts the transaction without partial
writes.

## Rollback and lost-key behavior

Application rollback alone is unsafe: older CrewCmd versions interpret the
ciphertext as a gateway token. To roll back across this change, stop CrewCmd and
restore the pre-migration database backup together with its matching
configuration.

If an encryption key is lost, CrewCmd fails closed and cannot reconstruct the
affected tokens. Restore a backup plus its matching keyring, or revoke and
replace the runtime tokens at each OpenClaw/Hermes provider and reconfigure the
runtimes under a new key. Never enable plaintext fallback to bypass an unknown,
missing, or failed ciphertext key.
