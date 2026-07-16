import {
  decryptRuntimeAuthToken,
  encryptRuntimeAuthToken,
  getRuntimeAuthTokenKeyId,
  isEncryptedRuntimeAuthToken,
  type RuntimeTokenKeyring,
} from "./runtime-token-crypto";

export interface StoredRuntimeTokenRow {
  id: string;
  authToken: string | null;
}
export interface RuntimeTokenMigrationSummary {
  scanned: number;
  withoutToken: number;
  plaintext: number;
  rotated: number;
  current: number;
  updates: number;
}

export interface RuntimeTokenMigrationPlan {
  summary: RuntimeTokenMigrationSummary;
  updates: Array<{ id: string; encryptedAuthToken: string }>;
}

/**
 * Builds an in-memory migration plan without mutating storage or returning
 * plaintext. Callers should apply all updates in one database transaction.
 */
export function planRuntimeTokenMigration(
  rows: readonly StoredRuntimeTokenRow[],
  keyring: RuntimeTokenKeyring,
): RuntimeTokenMigrationPlan {
  const summary: RuntimeTokenMigrationSummary = {
    scanned: rows.length,
    withoutToken: 0,
    plaintext: 0,
    rotated: 0,
    current: 0,
    updates: 0,
  };
  const updates: RuntimeTokenMigrationPlan["updates"] = [];

  for (const row of rows) {
    if (row.authToken === null) {
      summary.withoutToken += 1;
      continue;
    }

    if (!isEncryptedRuntimeAuthToken(row.authToken)) {
      summary.plaintext += 1;
      updates.push({
        id: row.id,
        encryptedAuthToken: encryptRuntimeAuthToken(row.authToken, keyring),
      });
      continue;
    }

    const plaintext = decryptRuntimeAuthToken(row.authToken, { keyring });
    if (getRuntimeAuthTokenKeyId(row.authToken) === keyring.activeKeyId) {
      summary.current += 1;
      continue;
    }

    summary.rotated += 1;
    updates.push({
      id: row.id,
      encryptedAuthToken: encryptRuntimeAuthToken(plaintext, keyring),
    });
  }

  summary.updates = updates.length;
  return { summary, updates };
}
