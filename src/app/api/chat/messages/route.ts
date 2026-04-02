import { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";

/**
 * GET /api/chat/messages?sessionId=xxx&limit=100
 *
 * Fetch messages for a chat session, oldest first.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const messages = await withRetry(() =>
      db!.select().from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId))
        .orderBy(asc(chatMessages.createdAt))
        .limit(limit)
    );

    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata,
      })),
    });
  } catch (error) {
    console.error("[api/chat/messages] Error:", error);
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * POST /api/chat/messages
 *
 * Save a message to a chat session. Creates session on-the-fly if needed.
 * Body: { sessionId: string, role: "user"|"assistant"|"system", content: string, metadata?: object }
 *   OR: { agentId: string, companyId: string, role: ..., content: ..., metadata?: ... }
 *       (auto-creates or reuses the latest session for that agent)
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  try {
    const body = await request.json() as {
      sessionId?: string;
      agentId?: string;
      companyId?: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.role || !body.content) {
      return Response.json({ error: "role and content required" }, { status: 400 });
    }

    let sessionId = body.sessionId;

    // Auto-resolve session: find or create for this agent
    if (!sessionId && body.agentId && body.companyId) {
      const agentLower = body.agentId.toLowerCase();

      // Find most recent session for this agent
      const existing = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(eq(chatSessions.agentId, agentLower))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (existing.length > 0) {
        sessionId = existing[0].id;
      } else {
        // Create a new session
        const [newSession] = await withRetry(() =>
          db!.insert(chatSessions).values({
            companyId: body.companyId!,
            agentId: agentLower,
          }).returning()
        );
        sessionId = newSession.id;
      }
    }

    if (!sessionId) {
      return Response.json(
        { error: "sessionId or (agentId + companyId) required" },
        { status: 400 }
      );
    }

    // Insert message
    const [message] = await withRetry(() =>
      db!.insert(chatMessages).values({
        sessionId,
        role: body.role,
        content: body.content,
        metadata: body.metadata || null,
      }).returning()
    );

    // Touch session updatedAt
    await withRetry(() =>
      db!.update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId!))
    );

    return Response.json({ message, sessionId }, { status: 201 });
  } catch (error) {
    console.error("[api/chat/messages] Save error:", error);
    return Response.json({ error: "Failed to save message" }, { status: 500 });
  }
}
