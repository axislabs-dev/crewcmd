/**
 * One-time script to upsert the Thoroughbreds.ai project in Mission Control.
 * Sets up the project with the TAI Context doc reference so agents see it
 * before picking up any TAI-related task.
 *
 * Usage:
 *   DATABASE_URL=<neon_url> npx tsx scripts/upsert-thoroughbreds-project.ts
 *
 * Or pipe through vercel env:
 *   vercel env pull .env.local && npx dotenv -e .env.local -- npx tsx scripts/upsert-thoroughbreds-project.ts
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { projects } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  // Check if Thoroughbreds project already exists
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.name, "Thoroughbreds.ai"));

  const taiDoc = {
    name: "TAI Context",
    url: "memory/tai-context.md",
  };

  if (existing.length > 0) {
    const project = existing[0];
    const currentDocs = project.documents ?? [];
    const alreadyLinked = currentDocs.some(
      (d) => d.name === "TAI Context" || d.url === "memory/tai-context.md"
    );

    if (alreadyLinked) {
      console.log(
        `✅ Thoroughbreds.ai project already has TAI Context doc linked (id: ${project.id})`
      );
      return;
    }

    // Add the doc to existing project
    const [updated] = await db
      .update(projects)
      .set({
        documents: [...currentDocs, taiDoc],
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id))
      .returning();

    console.log(`✅ Linked TAI Context doc to existing project: ${updated.id}`);
    return;
  }

  // Create the project
  const [created] = await db
    .insert(projects)
    .values({
      name: "Thoroughbreds.ai",
      description:
        "Roger's day job — CTO & co-founder. TAI is a racing analytics platform. Agents should read the TAI Context doc before picking up any TAI-related task.",
      status: "active",
      documents: [taiDoc],
    })
    .returning();

  console.log(`✅ Created Thoroughbreds.ai project: ${created.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
