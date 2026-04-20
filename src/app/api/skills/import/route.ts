import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const {
      source,
      query,
      companyId,
      workspaceId,
      name,
      slug,
      description,
      version,
      sourceUrl,
      content,
      metadata,
    } = body;

    if (!source) {
      return NextResponse.json({ error: "source is required" }, { status: 400 });
    }

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? null,
    });
    const resolvedCompanyId = workspace?.companyId ?? companyId ?? null;

    if (!workspace) {
      return NextResponse.json({ error: "workspaceId or companyId is required" }, { status: 400 });
    }

    if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      return NextResponse.json({ error: "metadata must be an object when provided" }, { status: 400 });
    }

    const skillName = name || query || "Imported Skill";
    const skillSlug = slug || skillName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const [created] = await withRetry(() =>
      db!.insert(schema.skills).values({
        workspaceId: workspace.id,
        name: skillName,
        slug: skillSlug,
        description: description || null,
        source,
        sourceUrl: sourceUrl || null,
        version: version || null,
        content: content || null,
        companyId: resolvedCompanyId,
        metadata: metadata || {},
        installed: true,
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/skills/import] POST Error:", err);
    return NextResponse.json({ error: "Failed to import skill" }, { status: 500 });
  }
}
