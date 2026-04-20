import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { toSecretMetadata } from "@/lib/service-secrets";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { requireAuth } = await import("@/lib/require-auth");
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, value, description } = body;

    if (name === undefined && value === undefined && description === undefined) {
      return NextResponse.json({ error: "name, value, or description is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) {
      const normalizedName = String(name).trim();
      if (!normalizedName) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      updates.name = normalizedName;
    }
    if (value !== undefined) {
      if (typeof value !== "string" || value.length === 0) {
        return NextResponse.json({ error: "value must be a non-empty string" }, { status: 400 });
      }
      updates.value = value;
    }
    if (description !== undefined) updates.description = description;

    const [updated] = await withRetry(() =>
      db!
        .update(schema.serviceSecrets)
        .set(updates)
        .where(eq(schema.serviceSecrets.id, id))
        .returning()
    );

    if (!updated) {
      return NextResponse.json({ error: "Secret not found" }, { status: 404 });
    }

    return NextResponse.json(toSecretMetadata(updated));
  } catch (err) {
    console.error("[api/service-secrets/[id]] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update secret" }, { status: 500 });
  }
}
