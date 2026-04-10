import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, withRetry } from "@/db";
import { agentSkills, agents, skills } from "@/db/schema";

interface SyncMeta {
  source?: string;
  skillId?: string;
  version?: string;
  syncedAt?: string;
  syncedBy?: string;
  sourceType?: string;
  previousChecksum?: string | null;
  checksum?: string;
}

function metaPathFor(runtimeRef: string, slug: string) {
  return join(homedir(), ".openclaw", `workspace-${runtimeRef}`, "skills", slug, ".crewcmd-meta.json");
}

export async function GET() {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const assignments = await withRetry(() =>
    db!
      .select({
        agentId: agents.id,
        agentCallsign: agents.callsign,
        runtimeRef: agents.runtimeRef,
        skillId: skills.id,
        skillSlug: skills.slug,
        skillName: skills.name,
        companyId: skills.companyId,
      })
      .from(agentSkills)
      .innerJoin(agents, eq(agentSkills.agentId, agents.id))
      .innerJoin(skills, eq(agentSkills.skillId, skills.id))
  );

  const items = await Promise.all(
    assignments.map(async (assignment) => {
      const runtimeRef = assignment.runtimeRef ?? assignment.agentId;
      const metaPath = metaPathFor(runtimeRef, assignment.skillSlug);

      try {
        const raw = await readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw) as SyncMeta;
        return {
          companyId: assignment.companyId,
          agentId: assignment.agentId,
          agentCallsign: assignment.agentCallsign,
          skillId: assignment.skillId,
          skillName: assignment.skillName,
          skillSlug: assignment.skillSlug,
          status: "synced" as const,
          syncedAt: meta.syncedAt ?? null,
          checksum: meta.checksum ?? null,
          previousChecksum: meta.previousChecksum ?? null,
          error: null,
        };
      } catch (error) {
        return {
          companyId: assignment.companyId,
          agentId: assignment.agentId,
          agentCallsign: assignment.agentCallsign,
          skillId: assignment.skillId,
          skillName: assignment.skillName,
          skillSlug: assignment.skillSlug,
          status: "missing" as const,
          syncedAt: null,
          checksum: null,
          previousChecksum: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  const total = items.length;
  const synced = items.filter((item) => item.status === "synced").length;
  const failed = total - synced;

  const lastSyncedAt = items
    .map((item) => item.syncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const byAgent = Object.values(
    items.reduce<Record<string, { agentId: string; agentCallsign: string; total: number; synced: number; failed: number; lastSyncedAt: string | null }>>((acc, item) => {
      const key = item.agentId;
      const entry = acc[key] ?? {
        agentId: item.agentId,
        agentCallsign: item.agentCallsign,
        total: 0,
        synced: 0,
        failed: 0,
        lastSyncedAt: null,
      };
      entry.total += 1;
      if (item.status === "synced") entry.synced += 1;
      else entry.failed += 1;
      if (item.syncedAt && (!entry.lastSyncedAt || item.syncedAt > entry.lastSyncedAt)) {
        entry.lastSyncedAt = item.syncedAt;
      }
      acc[key] = entry;
      return acc;
    }, {})
  );

  return NextResponse.json({
    summary: {
      totalAssignments: total,
      synced,
      failed,
      successRate: total === 0 ? 1 : synced / total,
      lastSyncedAt,
    },
    byAgent,
    items,
  });
}
