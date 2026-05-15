import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import type { DocCategory } from "@/lib/data";
import { requireUserOrRuntimeAuth } from "@/lib/require-auth";
import {
  getCompanyIdForWorkspace,
  isHeartbeatBearerRequest,
  resolveAccessibleWorkspace,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") as DocCategory | null;
  const docType = searchParams.get("docType");
  const visibility = searchParams.get("visibility");
  const authorId = searchParams.get("authorId");
  const projectId = searchParams.get("projectId");
  const taskId = searchParams.get("taskId");
  const search = searchParams.get("search");
  const pinned = searchParams.get("pinned");
  const tags = searchParams.get("tags"); // comma-separated
  const requestedCompanyId =
    searchParams.get("companyId") ??
    searchParams.get("company_id");
  const requestedWorkspaceId = searchParams.get("workspaceId");

  try {
    const heartbeat = await isHeartbeatBearerRequest(request);
    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: requestedWorkspaceId,
      explicitCompanyId: requestedCompanyId,
      requireExplicitForBearer: true,
    });

    if (!workspace) {
      if (heartbeat && !requestedCompanyId && !requestedWorkspaceId) {
        return NextResponse.json(
          { error: "workspaceId or companyId is required for bearer-scoped document listing" },
          { status: 400 }
        );
      }
      return NextResponse.json([]);
    }

    let result = await withRetry(() =>
      db!.select().from(schema.docs).where(eq(schema.docs.workspaceId, workspace.id))
    );

    if (category) {
      result = result.filter((d) => d.category === category);
    }
    if (docType) {
      result = result.filter((d) => d.docType === docType);
    }
    if (visibility) {
      result = result.filter((d) => d.visibility === visibility);
    }
    if (authorId) {
      result = result.filter(
        (d) => d.authorAgentId === authorId || d.authorUserId === authorId
      );
    }
    if (projectId) {
      result = result.filter((d) => d.projectId === projectId);
    }
    if (taskId) {
      result = result.filter((d) => d.taskId === taskId);
    }
    if (pinned === "true") {
      result = result.filter((d) => d.pinned);
    }
    if (tags) {
      const tagList = tags.split(",").map((t) => t.trim().toLowerCase());
      result = result.filter(
        (d) =>
          d.tags && d.tags.some((t) => tagList.includes(t.toLowerCase()))
      );
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

    // Pinned first, then by updatedAt descending
    result.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/docs] Database error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();

    if (!body.title || !body.content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 }
      );
    }

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: body.workspaceId ?? null,
      explicitCompanyId: body.companyId ?? null,
    });

    if (!workspace) {
      return NextResponse.json({ error: "workspaceId or companyId is required" }, { status: 400 });
    }
    const companyId = workspace.companyId ?? await getCompanyIdForWorkspace(workspace.id);

    const [doc] = await db
      .insert(schema.docs)
      .values({
        title: body.title,
        content: body.content,
        category: body.category || "general",
        docType: body.docType || "general",
        visibility: body.visibility || "company",
        authorAgentId: body.authorAgentId || null,
        authorUserId: body.authorUserId || null,
        projectId: body.projectId || null,
        taskId: body.taskId || null,
        tags: body.tags || [],
        workspaceId: workspace.id,
        companyId,
        pinned: body.pinned || false,
      })
      .returning();

    return NextResponse.json(doc, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
