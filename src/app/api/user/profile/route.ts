import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { users } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { uploadImage } from "@/lib/image-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const user = await resolveCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role,
    hasPassword: Boolean(user.passwordHash),
  });
}

export async function PATCH(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const user = await resolveCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      return await handleAvatarUpload(request, user.id);
    }

    const body = await request.json();
    const updates: Partial<typeof users.$inferInsert> = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      updates.name = name;
    }

    if (body.email !== undefined) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }

      const [existing] = await withRetry(() =>
        db!
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      );

      if (existing && existing.id !== user.id) {
        return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
      }

      updates.email = email;
    }

    if (body.avatarUrl !== undefined) {
      updates.avatarUrl = body.avatarUrl ? String(body.avatarUrl) : null;
    }

    if (body.currentPassword || body.newPassword || body.confirmPassword) {
      if (!user.passwordHash) {
        return NextResponse.json({ error: "Password changes are not available for this account" }, { status: 400 });
      }

      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

      if (!currentPassword || !newPassword || !confirmPassword) {
        return NextResponse.json({ error: "All password fields are required" }, { status: 400 });
      }

      const currentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!currentPasswordValid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }

      if (newPassword.length < 8) {
        return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
      }

      if (newPassword !== confirmPassword) {
        return NextResponse.json({ error: "New passwords do not match" }, { status: 400 });
      }

      if (newPassword === currentPassword) {
        return NextResponse.json({ error: "New password must be different from your current password" }, { status: 400 });
      }

      updates.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No changes submitted" }, { status: 400 });
    }

    const [updated] = await withRetry(() =>
      db!
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
          role: users.role,
          hasPassword: users.passwordHash,
        })
    );

    return NextResponse.json({
      ...updated,
      hasPassword: Boolean(updated?.hasPassword),
    });
  } catch (error) {
    console.error("[api/user/profile] PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 }
    );
  }
}

async function handleAvatarUpload(request: NextRequest, userId: string) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "png";
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await uploadImage(buffer, `avatar-user-${userId}-${Date.now()}.${ext}`);

  const [updated] = await withRetry(() =>
    db!
      .update(users)
      .set({ avatarUrl: upload.url })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.role,
        hasPassword: users.passwordHash,
      })
  );

  return NextResponse.json({
    ...updated,
    hasPassword: Boolean(updated?.hasPassword),
  });
}
