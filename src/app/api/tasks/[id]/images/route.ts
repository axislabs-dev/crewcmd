import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { uploadImage, ImageInfo } from "@/lib/image-storage";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/:id/images
 * Upload one or more images to a task.
 * Accepts FormData with a single "file" field or multiple "files" fields.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const formData = await request.formData();

    // Support both single "file" and multiple "files" fields
    const files: File[] = [];
    const singleFile = formData.get("file") as File | null;
    if (singleFile && singleFile.size > 0) {
      files.push(singleFile);
    }
    const multiFiles = formData.getAll("files") as File[];
    for (const f of multiFiles) {
      if (f && f.size > 0) files.push(f);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Validate all are images
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: `File "${file.name}" is not an image` },
          { status: 400 }
        );
      }
    }

    // Get the current task
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Upload all images
    const newImages: ImageInfo[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const imageInfo = await uploadImage(buffer, file.name);
      newImages.push(imageInfo);
    }

    const currentImages: ImageInfo[] = task.images || [];
    const updatedImages = [...currentImages, ...newImages];

    const [updatedTask] = await db
      .update(schema.tasks)
      .set({ images: updatedImages, updatedAt: new Date() })
      .where(eq(schema.tasks.id, id))
      .returning();

    return NextResponse.json({
      ...updatedTask,
      images: updatedImages,
    });
  } catch (error) {
    console.error("[api/tasks/:id/images] Error uploading image:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload image" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tasks/:id/images
 * Get all images for a task
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({
      images: task.images || [],
      taskId: task.id,
    });
  } catch (error) {
    console.error("[api/tasks/:id/images] Error fetching images:", error);
    return NextResponse.json(
      { error: "Failed to fetch images" },
      { status: 500 }
    );
  }
}