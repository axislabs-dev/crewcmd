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

// Strip content from tree nodes to keep the listing response small
function stripContent(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    const { content: _, ...rest } = node;
    if (rest.children) {
      rest.children = stripContent(rest.children);
    }
    return rest;
  });
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) return NextResponse.json([]);

  try {
    // Try to get the file tree from the database
    const result = await db.select().from(workspaceFiles).limit(1);

    if (result && result.length > 0 && result[0].fileTree) {
      const tree = result[0].fileTree as FileNode[];
      return NextResponse.json(stripContent(tree));
    }

    // Fallback: return empty array if no data in DB yet
    return NextResponse.json([]);
  } catch {
    return NextResponse.json(
      { error: "Failed to read workspace" },
      { status: 500 }
    );
  }
}
