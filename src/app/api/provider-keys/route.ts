import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

// GET: List provider keys for a company (returns masked keys)
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  if (!db) {
    return NextResponse.json({ keys: [] });
  }

  try {
    const keys = await withRetry(() =>
      db!
        .select()
        .from(schema.companyProviderKeys)
        .where(eq(schema.companyProviderKeys.companyId, companyId))
    );

    // Mask API keys — only show last 4 chars
    const masked = keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      maskedKey: k.apiKey.length > 4 ? "****" + k.apiKey.slice(-4) : "****",
      createdAt: k.createdAt.toISOString(),
      updatedAt: k.updatedAt.toISOString(),
    }));

    return NextResponse.json({ keys: masked });
  } catch (err) {
    console.error("[api/provider-keys] GET Error:", err);
    return NextResponse.json({ keys: [] });
  }
}

// POST: Create or update a provider key for a company
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { companyId, provider, apiKey, label } = body;

    if (!companyId || !provider || !apiKey) {
      return NextResponse.json(
        { error: "companyId, provider, and apiKey are required" },
        { status: 400 }
      );
    }

    const validProviders = ["anthropic", "openai", "google", "openrouter"];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Valid: ${validProviders.join(", ")}` },
        { status: 400 }
      );
    }

    // Check if key already exists for this company+provider — upsert
    const [existing] = await withRetry(() =>
      db!
        .select()
        .from(schema.companyProviderKeys)
        .where(
          and(
            eq(schema.companyProviderKeys.companyId, companyId),
            eq(schema.companyProviderKeys.provider, provider)
          )
        )
        .limit(1)
    );

    if (existing) {
      const [updated] = await withRetry(() =>
        db!
          .update(schema.companyProviderKeys)
          .set({
            apiKey,
            label: label || existing.label,
            updatedAt: new Date(),
          })
          .where(eq(schema.companyProviderKeys.id, existing.id))
          .returning()
      );
      return NextResponse.json({
        id: updated.id,
        provider: updated.provider,
        label: updated.label,
        maskedKey: updated.apiKey.length > 4 ? "****" + updated.apiKey.slice(-4) : "****",
      });
    }

    const [created] = await withRetry(() =>
      db!
        .insert(schema.companyProviderKeys)
        .values({
          companyId,
          provider,
          apiKey,
          label: label || null,
        })
        .returning()
    );

    return NextResponse.json(
      {
        id: created.id,
        provider: created.provider,
        label: created.label,
        maskedKey: created.apiKey.length > 4 ? "****" + created.apiKey.slice(-4) : "****",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[api/provider-keys] POST Error:", err);
    return NextResponse.json({ error: "Failed to save provider key" }, { status: 500 });
  }
}

// DELETE: Remove a provider key
export async function DELETE(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const keyId = request.nextUrl.searchParams.get("id");
  if (!keyId) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
  }

  try {
    await withRetry(() =>
      db!
        .delete(schema.companyProviderKeys)
        .where(eq(schema.companyProviderKeys.id, keyId))
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/provider-keys] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to delete provider key" }, { status: 500 });
  }
}
