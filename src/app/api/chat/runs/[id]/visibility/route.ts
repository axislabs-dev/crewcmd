import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { chatRuns } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

const VALID_VISIBILITY = new Set(["visible", "hidden", "disconnected"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(request);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const visibility = typeof body.visibility === "string" ? body.visibility : "";
  if (!VALID_VISIBILITY.has(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  const { id } = await context.params;
  const [run] = await withRetry(() =>
    db!.update(chatRuns)
      .set({ clientVisibility: visibility, updatedAt: new Date() })
      .where(and(eq(chatRuns.id, id), eq(chatRuns.userId, user.id)))
      .returning({ id: chatRuns.id, clientVisibility: chatRuns.clientVisibility })
  );

  if (!run) return NextResponse.json({ error: "Chat run not found" }, { status: 404 });
  return NextResponse.json({ run });
}

