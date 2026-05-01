import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, withRetry } from "@/db";
import { agentSkills, agents, skills } from "@/db/schema";
import { legacyOpenClawWorkspacePath, resolveOpenClawWorkspacePath } from "@/lib/openclaw-workspace-resolver";
import { deriveSkillSyncDrift } from "@/lib/skill-sync-drift";

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

function metaPathFor(workspacePath: string, slug: string) {
  return join(workspacePath, "skills", slug, ".crewcmd-meta.json");
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
        workspacePath: agents.workspacePath,
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
      const resolvedWorkspacePath = await resolveOpenClawWorkspacePath({
        runtimeRef,
        workspacePath: assignment.workspacePath ?? null,
      });
      const candidateMetaPaths = [
        resolvedWorkspacePath ? metaPathFor(resolvedWorkspacePath, assignment.skillSlug) : null,
        metaPathFor(legacyOpenClawWorkspacePath(runtimeRef), assignment.skillSlug),
      ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

      let lastError: unknown = null;
      for (const candidateMetaPath of candidateMetaPaths) {
        try {
          const raw = await readFile(candidateMetaPath, "utf-8");
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
            ...deriveSkillSyncDrift({
              status: "synced",
              checksum: meta.checksum ?? null,
              previousChecksum: meta.previousChecksum ?? null,
            }),
            error: null,
          };
        } catch (error) {
          lastError = error;
        }
      }

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
        ...deriveSkillSyncDrift({ status: "missing" }),
        error: lastError instanceof Error ? lastError.message : String(lastError),
      };
    })
  );

  const total = items.length;
  const synced = items.filter((item) => item.status === "synced").length;
  const failed = total - synced;
  const needsReview = items.filter((item) => item.requiresReview).length;
  const changed = items.filter((item) => item.driftStatus === "changed").length;
  const unknown = items.filter((item) => item.driftStatus === "unknown").length;

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
      needsReview,
      changed,
      unknown,
      successRate: total === 0 ? 1 : synced / total,
      lastSyncedAt,
    },
    byAgent,
    items,
  });
}
