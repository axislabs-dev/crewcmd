import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import { uploadImage, ImageUploadResult } from "@/lib/image-storage";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { callsign } = await params;

  try {
    const contentType = request.headers.get("content-type") || "";

    const avatarUrl: string | undefined | null =
      contentType.includes("multipart/form-data")
        ? await uploadAvatarFromForm(request, callsign)
        : await updateAvatarFromJson(request, callsign);

    if (avatarUrl === undefined) {
      return NextResponse.json(
        { error: "No avatar data or URL provided" },
        { status: 400 }
      );
    }

    const [updated] = await withRetry(() =>
      db!
        .update(agents)
        .set({ avatarUrl: avatarUrl })
        .where(eq(agents.callsign, callsign.toUpperCase()))
        .returning()
    );

    if (!updated) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({
      callsign: updated.callsign,
      avatarUrl: updated.avatarUrl,
    });
  } catch (error) {
    console.error("[api/agents/avatar] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update avatar" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { callsign } = await params;

  try {
    const [updated] = await withRetry(() =>
      db!
        .update(agents)
        .set({ avatarUrl: null })
        .where(eq(agents.callsign, callsign.toUpperCase()))
        .returning()
    );

    if (!updated) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({
      callsign: updated.callsign,
      avatarUrl: null,
    });
  } catch (error) {
    console.error("[api/agents/avatar] DELETE Error:", error);
    return NextResponse.json(
      { error: "Failed to remove avatar" },
      { status: 500 }
    );
  }
}

async function uploadAvatarFromForm(
  request: NextRequest,
  callsign: string
): Promise<string | undefined> {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    const directUrl = formData.get("url") as string | null;
    if (directUrl) return directUrl;
    return undefined;
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("File must be an image");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const upload = await uploadImage(buffer, `avatar-${callsign.toLowerCase()}-${Date.now()}.${ext}`);
  return upload.url;
}

async function updateAvatarFromJson(
  request: NextRequest,
  callsign: string
): Promise<string | null | undefined> {
  const body = await request.json();
  if ("avatarUrl" in body) {
    return body.avatarUrl === ""
      ? undefined
      : (body.avatarUrl as string | null);
  }
  return undefined;
}
