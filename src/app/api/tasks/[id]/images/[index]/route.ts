import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import type { ImageInfo } from "@/lib/image-storage";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; index: string }>;
}

/**
 * DELETE /api/tasks/:id/images/:index
 * Remove an image from a task by index
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id, index } = await params;

  try {
    const indexNum = parseInt(index, 10);
    if (isNaN(indexNum)) {
      return NextResponse.json({ error: "Invalid image index" }, { status: 400 });
    }

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const currentImages: ImageInfo[] = task.images || [];

    if (indexNum < 0 || indexNum >= currentImages.length) {
      return NextResponse.json({ error: "Image index out of bounds" }, { status: 400 });
    }

    const updatedImages = currentImages.filter((_, i) => i !== indexNum);

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
    console.error("[api/tasks/:id/images/:index] Error deleting image:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete image" },
      { status: 500 }
    );
  }
}
