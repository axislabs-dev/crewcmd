import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

async function requireCompanyAdmin(request: NextRequest, companyId: string) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const user = await resolveCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [membership] = await withRetry(() =>
    db!
      .select({ role: schema.companyMembers.role })
      .from(schema.companyMembers)
      .where(
        and(
          eq(schema.companyMembers.userId, user.id),
          eq(schema.companyMembers.companyId, companyId)
        )
      )
      .limit(1)
  );

  if (membership?.role !== "owner" && membership?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

function maskedKey(apiKey: string) {
  return apiKey.length > 4 ? "****" + apiKey.slice(-4) : "****";
}

// GET: List provider keys for a company (returns masked keys)
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  if (!db) {
    return NextResponse.json({ keys: [] });
  }

  const authError = await requireCompanyAdmin(request, companyId);
  if (authError) return authError;

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
      maskedKey: maskedKey(k.apiKey),
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

    const authError = await requireCompanyAdmin(request, companyId);
    if (authError) return authError;

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
        maskedKey: maskedKey(updated.apiKey),
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
        maskedKey: maskedKey(created.apiKey),
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
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const keyId = request.nextUrl.searchParams.get("id");
  if (!keyId) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
  }

  try {
    const [key] = await withRetry(() =>
      db!
        .select({ companyId: schema.companyProviderKeys.companyId })
        .from(schema.companyProviderKeys)
        .where(eq(schema.companyProviderKeys.id, keyId))
        .limit(1)
    );

    if (!key) {
      return NextResponse.json({ error: "Provider key not found" }, { status: 404 });
    }

    const authError = await requireCompanyAdmin(request, key.companyId);
    if (authError) return authError;

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
