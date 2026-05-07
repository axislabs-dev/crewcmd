import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";

type Journal = {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

type MigrationRecord = {
  id: number;
  hash: string;
  created_at: string | number | null;
};

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}

function readJournal() {
  const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  return journal.entries;
}

function migrationHash(tag: string) {
  const migrationPath = path.join(process.cwd(), "drizzle", `${tag}.sql`);
  return crypto.createHash("sha256").update(fs.readFileSync(migrationPath, "utf8")).digest("hex");
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("DATABASE_URL is not set. This install uses local PGlite; run pnpm db:migrate normally.");
    return;
  }

  const entries = readJournal();
  const baselineTag = argValue("--baseline-through");
  const applyBaseline = hasFlag("--apply") && hasFlag("--yes");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const migrationTable = await sql<{ exists: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists
    `;
    const migrationRows = migrationTable[0]?.exists
      ? await sql<MigrationRecord[]>`
          select id, hash, created_at
          from drizzle.__drizzle_migrations
          order by created_at
        `
      : [];
    const publicObjects = await sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
    `;
    const last = migrationRows.at(-1);

    console.log(JSON.stringify({
      migrationRows: migrationRows.length,
      lastMigrationCreatedAt: last?.created_at ?? null,
      publicTables: publicObjects[0]?.count ?? 0,
      journalEntries: entries.length,
      latestJournalTag: entries.at(-1)?.tag ?? null,
    }, null, 2));

    if (migrationRows.length === 0 && (publicObjects[0]?.count ?? 0) > 0) {
      console.log("");
      console.log("The database has public schema objects but no Drizzle migration history.");
      console.log("For an existing database, baseline to the last migration already represented in the schema, then run pnpm db:migrate.");
      console.log(`Latest migration known to this checkout: ${entries.at(-1)?.tag}`);
    }

    if (!baselineTag) return;

    const entry = entries.find((item) => item.tag === baselineTag);
    if (!entry) {
      throw new Error(`Unknown migration tag: ${baselineTag}`);
    }
    const hash = migrationHash(entry.tag);
    const statement = `insert into drizzle.__drizzle_migrations (hash, created_at) values ('${hash}', ${entry.when});`;

    console.log("");
    console.log(`Baseline statement for ${entry.tag}:`);
    console.log(statement);

    if (!applyBaseline) {
      console.log("");
      console.log("Read-only mode. Re-run with --apply --yes to insert this baseline row.");
      return;
    }
    if (migrationRows.length > 0) {
      throw new Error("Refusing to apply baseline because drizzle.__drizzle_migrations is not empty.");
    }

    await sql`create schema if not exists drizzle`;
    await sql`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;
    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${entry.when})`;
    console.log(`Applied baseline through ${entry.tag}. Now run pnpm db:migrate.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
