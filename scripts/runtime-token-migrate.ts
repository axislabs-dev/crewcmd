import { existsSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import dotenv from "dotenv";
import postgres from "postgres";
import { acquirePgliteProcessLock } from "../src/db/pglite-process-lock";
import { loadRuntimeTokenKeyring } from "../src/lib/runtime-token-crypto";
import {
  planRuntimeTokenMigration,
  type RuntimeTokenMigrationSummary,
  type StoredRuntimeTokenRow,
} from "../src/lib/runtime-token-migration";

function loadEnv(): void {
  for (const file of [".env", ".env.local"]) {
    if (existsSync(file)) dotenv.config({ path: file, override: false });
  }
}

function wantsApply(): boolean {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--yes");
  if (apply !== confirmed) {
    throw new Error("Writes require both --apply and --yes; omit both for a dry run");
  }
  return apply;
}

function printResult(
  database: "pglite" | "postgres",
  activeKeyId: string,
  apply: boolean,
  summary: RuntimeTokenMigrationSummary,
): void {
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    database,
    activeKeyId,
    ...summary,
  }, null, 2));
  if (!apply && summary.updates > 0) {
    console.log("Dry run only. Back up the database, stop CrewCMD, then rerun with --apply --yes.");
  }
}

async function migratePglite(apply: boolean): Promise<void> {
  const configuredDataDir = process.env.CREWCMD_PGLITE_DATA_DIR;
  const dataDir = configuredDataDir
    ? path.resolve(process.cwd(), configuredDataDir)
    : path.join(process.cwd(), ".data", "pglite");
  if (!existsSync(dataDir)) {
    throw new Error(`No PGlite database found at ${dataDir}`);
  }

  const releaseLock = acquirePgliteProcessLock(dataDir);
  const client = await PGlite.create(dataDir);
  try {
    const keyring = loadRuntimeTokenKeyring();
    const summary = await client.transaction(async (tx: Transaction) => {
      const result = await tx.query<StoredRuntimeTokenRow>(
        "select id::text as id, auth_token as \"authToken\" from company_runtimes order by id for update",
      );
      const plan = planRuntimeTokenMigration(result.rows, keyring);
      if (apply) {
        for (const update of plan.updates) {
          await tx.query(
            "update company_runtimes set auth_token = $1, updated_at = now() where id = $2::uuid",
            [update.encryptedAuthToken, update.id],
          );
        }
      }
      return plan.summary;
    });
    printResult("pglite", keyring.activeKeyId, apply, summary);
  } finally {
    await client.close();
    releaseLock();
  }
}

async function migratePostgres(databaseUrl: string, apply: boolean): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const keyring = loadRuntimeTokenKeyring();
    const summary = await client.begin(async (tx) => {
      const rows = await tx.unsafe<StoredRuntimeTokenRow[]>(`
        select id::text as id, auth_token as "authToken"
        from company_runtimes
        order by id
        for update
      `);
      const plan = planRuntimeTokenMigration(rows, keyring);
      if (apply) {
        for (const update of plan.updates) {
          await tx.unsafe(
            "update company_runtimes set auth_token = $1, updated_at = now() where id = $2::uuid",
            [update.encryptedAuthToken, update.id],
          );
        }
      }
      return plan.summary;
    });
    printResult("postgres", keyring.activeKeyId, apply, summary);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const apply = wantsApply();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    await migratePostgres(databaseUrl, apply);
  } else {
    await migratePglite(apply);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Runtime token migration failed";
  console.error(`[runtime-token-migrate] ${message}`);
  process.exitCode = 1;
});
