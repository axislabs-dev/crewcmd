import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient } from "@/lib/gateway-chat-pool";
import { db } from "@/db";
import { gatewaySessions } from "@/db/schema";
import { ensureEventBridge } from "@/lib/init-event-bridge";
import { extractAgentFromSessionKey } from "@/lib/openclaw-session-key";

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw/sessions?runtimeId=xxx
 *
 * Fetch all sessions from the OpenClaw gateway, upsert them into
 * gateway_sessions, and return the full list with agents and defaults.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  try {
    await ensureEventBridge();
    const client = await getGatewayClient();

    const result = await client.rpc<Record<string, unknown>>(
      "sessions.list",
      {}
    );

    const sessions = (result.sessions as Array<Record<string, unknown>>) || [];
    const agents = (result.agents as Array<Record<string, unknown>>) || [];
    const defaults = (result.defaults as Record<string, unknown>) || {};

    // Upsert sessions into gateway_sessions
    for (const s of sessions) {
      const updatedAt = s.updatedAt ? new Date(s.updatedAt as string) : null;
      const tokenUsage = {
        input: s.inputTokens as number | undefined,
        output: s.outputTokens as number | undefined,
        total: s.totalTokens as number | undefined,
      };

      await db
        .insert(gatewaySessions)
        .values({
          key: s.key as string,
          agentId: extractAgentFromSessionKey(s.key as string),
          spawnedByKey: (s.spawnedBy as string) || null,
          kind: s.kind as string,
          label: (s.label as string) || null,
          title: (s.derivedTitle as string) || null,
          lastMessagePreview: (s.lastMessagePreview as string) || null,
          updatedAt,
          tokenUsage,
          model: (s.model as string) || null,
          modelProvider: (s.modelProvider as string) || null,
          sessionId: (s.sessionId as string) || null,
        })
        .onConflictDoUpdate({
          target: gatewaySessions.key,
          set: {
            agentId: extractAgentFromSessionKey(s.key as string),
            spawnedByKey: (s.spawnedBy as string) || null,
            kind: s.kind as string,
            label: (s.label as string) || null,
            title: (s.derivedTitle as string) || null,
            lastMessagePreview: (s.lastMessagePreview as string) || null,
            updatedAt,
            tokenUsage,
            model: (s.model as string) || null,
            modelProvider: (s.modelProvider as string) || null,
            sessionId: (s.sessionId as string) || null,
          },
        });
    }

    return Response.json({ sessions, agents, defaults });
  } catch (error) {
    console.error("[api/openclaw/sessions] Error:", error);
    return Response.json(
      { error: "Failed to fetch sessions", details: error instanceof Error ? error.message : null },
      { status: 500 }
    );
  }
}
