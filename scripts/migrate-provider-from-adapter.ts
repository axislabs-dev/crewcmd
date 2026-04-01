/**
 * Data migration: Infer `provider` from `adapter_type` for existing agents.
 *
 * Usage:
 *   npx tsx scripts/migrate-provider-from-adapter.ts
 *
 * Mapping:
 *   claude_local   → anthropic
 *   codex_local    → openai
 *   gemini_local   → google
 *   openrouter     → openrouter
 *   (others)       → null (no change)
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull } from "drizzle-orm";
import * as schema from "../src/db/schema";

const ADAPTER_TO_PROVIDER: Record<string, string> = {
  claude_local: "anthropic",
  codex_local: "openai",
  gemini_local: "google",
  openrouter: "openrouter",
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL env var is required.");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });

  // Fetch agents that don't have a provider set yet
  const agents = await db
    .select({
      id: schema.agents.id,
      callsign: schema.agents.callsign,
      adapterType: schema.agents.adapterType,
      provider: schema.agents.provider,
    })
    .from(schema.agents)
    .where(isNull(schema.agents.provider));

  console.log(`Found ${agents.length} agent(s) with no provider set.\n`);

  let updated = 0;
  let skipped = 0;

  for (const agent of agents) {
    const provider = ADAPTER_TO_PROVIDER[agent.adapterType];
    if (!provider) {
      console.log(`  SKIP  ${agent.callsign} (adapter_type="${agent.adapterType}" — no mapping)`);
      skipped++;
      continue;
    }

    await db
      .update(schema.agents)
      .set({ provider })
      .where(eq(schema.agents.id, agent.id));

    console.log(`  SET   ${agent.callsign} → provider="${provider}" (was adapter_type="${agent.adapterType}")`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
