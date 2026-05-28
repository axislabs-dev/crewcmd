import "dotenv/config";
import { eq } from "drizzle-orm";
import { teamBlueprints } from "./schema";
import type { BlueprintTemplate } from "./schema";

/**
 * Resolve the correct Drizzle DB instance for the current environment.
 *
 * - DATABASE_URL set -> Neon or standard Postgres via ./index
 * - No DATABASE_URL  -> PGlite (local dev); we bootstrap it directly here
 *   because instrumentation.ts doesn't run when executing via `tsx`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDb(): Promise<any> {
  if (process.env.DATABASE_URL) {
    const isNeon =
      process.env.DATABASE_URL.includes("neon.tech") ||
      process.env.DATABASE_URL.includes("neon.") ||
      !!process.env.USE_NEON_DRIVER;
    console.log(
      `[seed] Using ${isNeon ? "Neon (serverless)" : "Postgres (standard)"} - DATABASE_URL is set`
    );
    const { db } = await import("./index");
    return db;
  }

  console.log("[seed] Using PGlite (local dev mode)");
  const { pgliteDb, migrationPromise } = await import("./pglite");
  await migrationPromise;
  return pgliteDb;
}

async function seed() {
  const db = await getDb();

  const startupTemplate: BlueprintTemplate = {
    agents: [
      {
        callsign: "Founder",
        name: "Founder",
        title: "CEO & Visionary",
        emoji: "🚀",
        color: "#00f0ff",
        role: "executive",
        adapterType: "openclaw_gateway",
        skills: ["web-browse", "shell"],
      },
      {
        callsign: "Builder",
        name: "Builder",
        title: "Full-Stack Engineer",
        emoji: "🔧",
        color: "#f0ff00",
        role: "engineer",
        adapterType: "openclaw_gateway",
        reportsTo: "Founder",
        skills: ["claude-code", "github", "shell"],
      },
      {
        callsign: "Hustler",
        name: "Hustler",
        title: "Growth & Marketing Lead",
        emoji: "📣",
        color: "#ff6600",
        role: "marketing",
        adapterType: "openclaw_gateway",
        reportsTo: "Founder",
        skills: ["web-browse"],
      },
      {
        callsign: "Ops",
        name: "Ops",
        title: "Operations & Finance",
        emoji: "📊",
        color: "#00ff88",
        role: "operations",
        adapterType: "openclaw_gateway",
        reportsTo: "Founder",
        skills: ["file-system", "shell"],
      },
    ],
    hierarchy: [
      { callsign: "Founder", children: ["Builder", "Hustler", "Ops"] },
    ],
    description:
      "A lean founding team for an early-stage startup: CEO, engineer, growth lead, and ops.",
    useCases: [
      "MVP development",
      "Early-stage product launch",
      "Bootstrapped startup operations",
    ],
  };

  const [existing] = await db
    .select({ id: teamBlueprints.id })
    .from(teamBlueprints)
    .where(eq(teamBlueprints.slug, "startup-founding-team"))
    .limit(1);

  if (existing) {
    console.log("[seed] Built-in team blueprints already exist - skipping.");
    process.exit(0);
  }

  console.log("[seed] Seeding built-in team blueprints...");
  await db.insert(teamBlueprints).values([
    {
      name: "Startup Founding Team",
      slug: "startup-founding-team",
      description:
        "A lean 4-person founding team covering engineering, growth, and operations - perfect for going from zero to one.",
      category: "Startup",
      icon: "🚀",
      agentCount: 4,
      isBuiltIn: true,
      template: startupTemplate,
      popularity: 0,
    },
  ]);

  console.log("[seed] Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
