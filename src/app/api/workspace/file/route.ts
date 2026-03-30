import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaceFiles } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  content?: string;
  children?: FileNode[];
}

function findFileInTree(nodes: FileNode[], filePath: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "file" && node.path === filePath) {
      return node;
    }
    if (node.type === "directory" && node.children) {
      const found = findFileInTree(node.children, filePath);
      if (found) return found;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Only allow .md files
  if (!filePath.endsWith(".md")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  // Prevent path traversal
  if (filePath.includes("..") || filePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const result = await db.select().from(workspaceFiles).limit(1);

    if (!result || result.length === 0 || !result[0].fileTree) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const tree = result[0].fileTree as FileNode[];
    const file = findFileInTree(tree, filePath);

    if (!file || file.content === undefined) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ path: filePath, content: file.content });
  } catch {
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { path: filePath, content } = body;

    if (!filePath || typeof content !== "string") {
      return NextResponse.json(
        { error: "Missing path or content" },
        { status: 400 }
      );
    }

    if (!filePath.endsWith(".md") || filePath.includes("..") || filePath.startsWith("/")) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    if (!db) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    // Update file content in the DB tree
    const result = await db.select().from(workspaceFiles).limit(1);

    if (!result || result.length === 0 || !result[0].fileTree) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const tree = result[0].fileTree as FileNode[];
    const file = findFileInTree(tree, filePath);

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Update content in place
    file.content = content;

    // Save back to DB
    await db.update(workspaceFiles).set({
      fileTree: tree,
      updatedAt: new Date(),
    });

    return NextResponse.json({ path: filePath, saved: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to write file" },
      { status: 500 }
    );
  }
}
