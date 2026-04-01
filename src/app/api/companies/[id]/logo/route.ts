import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/companies/[id]/logo — upload company logo */
export async function POST(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db)
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );

  const { id } = await params;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPEG, GIF, WebP, SVG" },
        { status: 400 }
      );
    }

    // Max 2MB
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Max 2MB." },
        { status: 400 }
      );
    }

    let logoUrl: string;

    // Try Vercel Blob if available
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const blob = await put(`logos/${id}/${file.name}`, file, {
        access: "public",
      });
      logoUrl = blob.url;
    } else {
      // Fallback: store as base64 data URL (works for PGlite dev)
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      logoUrl = `data:${file.type};base64,${base64}`;
    }

    // Update company record
    const [updated] = await db
      .update(companies)
      .set({ logoUrl, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({ logoUrl: updated.logoUrl });
  } catch (error) {
    console.error("[api/companies/logo] Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}

/** DELETE /api/companies/[id]/logo — remove company logo */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db)
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );

  const { id } = await params;

  const [updated] = await db
    .update(companies)
    .set({ logoUrl: null, updatedAt: new Date() })
    .where(eq(companies.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
