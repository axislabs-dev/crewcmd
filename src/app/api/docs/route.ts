import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import type { DocCategory } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") as DocCategory | null;
  const authorId = searchParams.get("authorId");
  const projectId = searchParams.get("projectId");
  const taskId = searchParams.get("taskId");
  const search = searchParams.get("search");

  try {
    let result = await withRetry(() => db!.select().from(schema.docs));

    if (category) {
      result = result.filter((d) => d.category === category);
    }
    if (authorId) {
      result = result.filter((d) => d.authorAgentId === authorId);
    }
    if (projectId) {
      result = result.filter((d) => d.projectId === projectId);
    }
    if (taskId) {
      result = result.filter((d) => d.taskId === taskId);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.content.toLowerCase().includes(q) ||
          (d.tags && d.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }

    result.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/docs] Database error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.title || !body.content || !body.category) {
      return NextResponse.json(
        { error: "title, content, and category are required" },
        { status: 400 }
      );
    }

    const [doc] = await db.insert(schema.docs).values({
      title: body.title,
      content: body.content,
      category: body.category,
      authorAgentId: body.authorAgentId || null,
      projectId: body.projectId || null,
      taskId: body.taskId || null,
      tags: body.tags || [],
    }).returning();

    return NextResponse.json(doc, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
