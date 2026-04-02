import { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import { chatSessions } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";

/**
 * GET /api/chat/sessions?agentId=neo&companyId=xxx
 *
 * List chat sessions for an agent, most recent first.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return Response.json({ error: "companyId required" }, { status: 400 });
  }

  try {
    const conditions = [eq(chatSessions.companyId, companyId)];
    if (agentId) {
      conditions.push(eq(chatSessions.agentId, agentId.toLowerCase()));
    }

    const sessions = await withRetry(() =>
      db!.select().from(chatSessions)
        .where(and(...conditions))
        .orderBy(desc(chatSessions.updatedAt))
        .limit(50)
    );

    return Response.json({ sessions });
  } catch (error) {
    console.error("[api/chat/sessions] Error:", error);
    return Response.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

/**
 * POST /api/chat/sessions
 *
 * Create a new chat session.
 * Body: { agentId: string, companyId: string, title?: string }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  try {
    const body = await request.json() as { agentId: string; companyId: string; title?: string };
    if (!body.agentId || !body.companyId) {
      return Response.json({ error: "agentId and companyId required" }, { status: 400 });
    }

    const [session] = await withRetry(() =>
      db!.insert(chatSessions).values({
        companyId: body.companyId,
        agentId: body.agentId.toLowerCase(),
        title: body.title || null,
      }).returning()
    );

    return Response.json({ session }, { status: 201 });
  } catch (error) {
    console.error("[api/chat/sessions] Create error:", error);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
