import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import type { ProjectStatus } from "@/lib/data";
import { requireUserOrRuntimeAuth } from "@/lib/require-auth";
import {
  getCompanyIdForWorkspace,
  isHeartbeatBearerRequest,
  resolveAccessibleWorkspace,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as ProjectStatus | null;
  const ownerId = searchParams.get("ownerId");
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
          { error: "workspaceId or companyId is required for bearer-scoped project listing" },
          { status: 400 }
        );
      }
      return NextResponse.json([]);
    }

    let result = await withRetry(() =>
      db!.select().from(schema.projects).where(eq(schema.projects.workspaceId, workspace.id))
    );

    if (result.length === 0) {
      result = await withRetry(() =>
        db!
          .select()
          .from(schema.projects)
          .where(and(isNull(schema.projects.workspaceId), isNull(schema.projects.companyId)))
      );
    }

    if (status) {
      result = result.filter((p) => p.status === status);
    }
    if (ownerId) {
      result = result.filter((p) => p.ownerAgentId === ownerId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/projects] Database error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
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

    const [project] = await db.insert(schema.projects).values({
      name: body.name,
      description: body.description || null,
      url: body.url || null,
      folder: body.folder || null,
      color: body.color || "#00f0ff",
      status: body.status || "active",
      ownerAgentId: body.ownerAgentId || null,
      documents: body.documents || null,
      workspaceId: workspace.id,
      companyId,
    }).returning();

    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
