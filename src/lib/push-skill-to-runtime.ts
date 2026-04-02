/**
 * Push the CrewCmd Task Management skill to all agents on a runtime.
 *
 * Strategy (in order):
 * 1. Try agents.files.put RPC (may not exist in all gateway versions)
 * 2. Fall back to chat message asking the agent to write the file
 * 3. Last resort for local runtimes: write directly via fs if workspace is accessible
 *
 * Also creates/updates the system skill record in the skills table
 * and links it to all agents on the runtime.
 */

import { db, withRetry } from "@/db";
import { companyRuntimes, skills, agentSkills, agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { generateCrewCmdSkill } from "./crewcmd-skill-template";
import { detectCallbackUrl } from "./detect-callback-url";
import fs from "node:fs/promises";
import path from "node:path";

const SYSTEM_SKILL_SLUG = "crewcmd-task-management";
const SYSTEM_SKILL_NAME = "CrewCmd Task Management";

export async function pushSkillToRuntime(runtimeId: string): Promise<void> {
  if (!db) throw new Error("Database not available");

  // Load runtime
  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, runtimeId))
  );
  if (!runtime) throw new Error(`Runtime ${runtimeId} not found`);

  // Detect callback URL based on gateway network
  const baseUrl = detectCallbackUrl(runtime.gatewayUrl);
  const authToken = process.env.HEARTBEAT_SECRET || "";

  if (!authToken) {
    console.warn("[push-skill] No HEARTBEAT_SECRET configured, skill will have empty auth token");
  }

  // Generate the SKILL.md content
  const skillContent = generateCrewCmdSkill({
    baseUrl,
    authToken,
    companyId: runtime.companyId,
  });

  // Try to push the skill file to each agent on the runtime
  const runtimeAgents = await withRetry(() =>
    db!.select().from(agents).where(eq(agents.runtimeId, runtimeId))
  );

  if (runtimeAgents.length > 0) {
    await pushViaGateway(runtime, runtimeAgents, skillContent);
  }

  // Create or update the system skill record in DB
  const skillRecord = await upsertSystemSkill(
    runtime.companyId,
    skillContent
  );

  // Link skill to all agents on this runtime
  await linkSkillToAgents(skillRecord.id, runtimeAgents.map((a) => a.id));

  console.log(
    `[push-skill] Pushed CrewCmd skill to runtime ${runtimeId}: ${runtimeAgents.length} agents, baseUrl=${baseUrl}`
  );
}

async function pushViaGateway(
  runtime: typeof companyRuntimes.$inferSelect,
  runtimeAgents: (typeof agents.$inferSelect)[],
  skillContent: string
): Promise<void> {
  // Connect to gateway
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const device = resolveDeviceIdentity(deviceKeyPem);
  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    device,
    15000
  );

  try {
    await client.connect();

    for (const agent of runtimeAgents) {
      if (!agent.runtimeRef) continue;

      // Strategy 1: Try agents.files.put RPC
      try {
        await client.rpc("agents.files.put", {
          agentId: agent.runtimeRef,
          name: "SKILL.md",
          content: skillContent,
        });
        console.log(`[push-skill] Wrote SKILL.md via RPC for agent ${agent.callsign}`);
        continue;
      } catch {
        // RPC not supported, try next strategy
      }

      // Strategy 2: Send chat message asking agent to write the file
      try {
        const msg = [
          "SYSTEM: Please write the following content to a file called SKILL.md in your workspace root directory.",
          "Create the file if it doesn't exist, or overwrite it if it does.",
          "Do not modify the content. Just write it exactly as provided.",
          "",
          "```",
          skillContent,
          "```",
        ].join("\n");

        await client.chatSend({ message: msg, sessionKey: "system" });
        console.log(`[push-skill] Sent SKILL.md via chat for agent ${agent.callsign}`);
        continue;
      } catch {
        // Chat failed too
      }

      // Strategy 3: Direct filesystem write for local workspaces
      await tryDirectWrite(client, agent, skillContent);
    }
  } finally {
    client.close();
  }
}

async function tryDirectWrite(
  client: GatewayClient,
  agent: typeof agents.$inferSelect,
  skillContent: string
): Promise<void> {
  if (!agent.runtimeRef) return;

  try {
    // Try to get the file list to discover the workspace path
    const filesResult = await client.rpc<{
      agentId: string;
      workspace: string;
      files: unknown[];
    }>("agents.files.list", { agentId: agent.runtimeRef });

    if (filesResult.workspace) {
      const skillPath = path.join(filesResult.workspace, "SKILL.md");
      await fs.writeFile(skillPath, skillContent, "utf-8");
      console.log(`[push-skill] Wrote SKILL.md directly to ${skillPath} for agent ${agent.callsign}`);
    }
  } catch {
    console.warn(`[push-skill] All strategies failed for agent ${agent.callsign}`);
  }
}

async function upsertSystemSkill(
  companyId: string,
  content: string
): Promise<{ id: string }> {
  if (!db) throw new Error("Database not available");

  // Check if system skill already exists for this company
  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.companyId, companyId),
          eq(skills.slug, SYSTEM_SKILL_SLUG),
          eq(skills.source, "system")
        )
      )
  );

  if (existing) {
    // Update content
    await withRetry(() =>
      db!
        .update(skills)
        .set({ content, updatedAt: new Date() })
        .where(eq(skills.id, existing.id))
    );
    return { id: existing.id };
  }

  // Create new
  const [created] = await withRetry(() =>
    db!
      .insert(skills)
      .values({
        companyId,
        name: SYSTEM_SKILL_NAME,
        slug: SYSTEM_SKILL_SLUG,
        description:
          "Allows agents to manage tasks, report progress, and collaborate through CrewCmd's task board API.",
        source: "system",
        content,
        installed: true,
      })
      .returning({ id: skills.id })
  );

  return created;
}

async function linkSkillToAgents(
  skillId: string,
  agentIds: string[]
): Promise<void> {
  if (!db || agentIds.length === 0) return;

  for (const agentId of agentIds) {
    // Check if already linked
    const [existing] = await withRetry(() =>
      db!
        .select()
        .from(agentSkills)
        .where(
          and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, skillId))
        )
    );

    if (!existing) {
      await withRetry(() =>
        db!.insert(agentSkills).values({ agentId, skillId })
      );
    }
  }
}
