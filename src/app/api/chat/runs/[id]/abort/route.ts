import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatRuns } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { abortRegisteredChatRun } from "@/lib/chat-run-abort-registry";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(request);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const { id } = await context.params;
  const [run] = await withRetry(() =>
    db!.select({ id: chatRuns.id })
      .from(chatRuns)
      .where(and(eq(chatRuns.id, id), eq(chatRuns.userId, user.id)))
      .limit(1)
  );
  if (!run) return NextResponse.json({ error: "Chat run not found" }, { status: 404 });

  const aborted = await abortRegisteredChatRun(id);
  if (!aborted) {
    await withRetry(() =>
      db!.update(chatRuns)
        .set({ status: "aborted", updatedAt: new Date(), completedAt: new Date() })
        .where(eq(chatRuns.id, id))
    );
  }

  return NextResponse.json({ aborted });
}

