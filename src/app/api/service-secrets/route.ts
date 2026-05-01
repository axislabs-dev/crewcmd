import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { apiError } from "@/lib/api-response";
import { toSecretMetadata } from "@/lib/service-secrets";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedCompanyId = request.nextUrl.searchParams.get("companyId");
  const requestedWorkspaceId = request.nextUrl.searchParams.get("workspaceId");
  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: requestedWorkspaceId,
    explicitCompanyId: requestedCompanyId,
  });

  if (!workspace) {
    return apiError({
      status: 400,
      code: "workspace_required",
      message: "workspaceId or companyId is required",
    });
  }

  if (!db) {
    return NextResponse.json({ secrets: [] });
  }

  try {
    const secrets = await withRetry(() =>
      db!
        .select()
        .from(schema.serviceSecrets)
        .where(and(
          eq(schema.serviceSecrets.workspaceId, workspace.id),
          workspace.companyId
            ? eq(schema.serviceSecrets.companyId, workspace.companyId)
            : isNull(schema.serviceSecrets.companyId),
        ))
    );

    return NextResponse.json({ secrets: secrets.map(toSecretMetadata) });
  } catch (err) {
    console.error("[api/service-secrets] GET Error:", err);
    return NextResponse.json({ secrets: [] });
  }
}

export async function POST(request: NextRequest) {
  const { requireAuth } = await import("@/lib/require-auth");
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return apiError({
      status: 503,
      code: "database_unavailable",
      message: "Database not available",
    });
  }

  try {
    const body = await request.json();
    const { companyId, workspaceId, name, value, description } = body;
    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? null,
    });

    if (!workspace || !name || value === undefined) {
      return apiError({
        status: 400,
        code: "invalid_secret_request",
        message: "workspaceId or companyId, name, and value are required",
      });
    }

    if (typeof value !== "string" || value.length === 0) {
      return apiError({
        status: 400,
        code: "invalid_secret_value",
        message: "value must be a non-empty string",
      });
    }

    const normalizedName = String(name).trim();
    if (!normalizedName) {
      return apiError({
        status: 400,
        code: "invalid_secret_name",
        message: "name is required",
      });
    }

    const [existing] = await withRetry(() =>
      db!
        .select()
        .from(schema.serviceSecrets)
        .where(
          and(
            eq(schema.serviceSecrets.workspaceId, workspace.id),
            workspace.companyId
              ? eq(schema.serviceSecrets.companyId, workspace.companyId)
              : isNull(schema.serviceSecrets.companyId),
            eq(schema.serviceSecrets.name, normalizedName)
          )
        )
        .limit(1)
    );

    if (existing) {
      const [updated] = await withRetry(() =>
        db!
          .update(schema.serviceSecrets)
          .set({
            value,
            description: description ?? existing.description,
            updatedAt: new Date(),
          })
          .where(eq(schema.serviceSecrets.id, existing.id))
          .returning()
      );

      return NextResponse.json(toSecretMetadata(updated));
    }

    const [created] = await withRetry(() =>
      db!
        .insert(schema.serviceSecrets)
        .values({
          workspaceId: workspace.id,
          companyId: workspace.companyId ?? null,
          name: normalizedName,
          description: description ?? null,
          value,
        })
        .returning()
    );

    return NextResponse.json(toSecretMetadata(created), { status: 201 });
  } catch (err) {
    console.error("[api/service-secrets] POST Error:", err);
    return apiError({
      status: 500,
      code: "secret_save_failed",
      message: "Failed to save secret",
    });
  }
}
