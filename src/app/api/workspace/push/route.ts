import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaceFiles } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.HEARTBEAT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const fileTree = await req.json();

    // Upsert the file tree - we use a fixed UUID for the single row
    // This ensures we always update the same row
    await db.insert(workspaceFiles).values({
      id: "00000000-0000-0000-0000-000000000001",
      fileTree: fileTree,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: workspaceFiles.id,
      set: {
        fileTree: fileTree,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, count: Array.isArray(fileTree) ? fileTree.length : 0 });
  } catch (error) {
    console.error("Failed to push workspace files:", error);
    return NextResponse.json(
      { error: "Failed to push workspace files" },
      { status: 500 }
    );
  }
}