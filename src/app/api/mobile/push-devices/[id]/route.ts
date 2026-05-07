import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { mobilePushDevices } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(_request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(_request);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const { id } = await context.params;
  const [device] = await withRetry(() =>
    db!.update(mobilePushDevices)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(mobilePushDevices.id, id), eq(mobilePushDevices.userId, user.id)))
      .returning({ id: mobilePushDevices.id })
  );

  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

