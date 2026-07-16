import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { getAgentAccessContext, runtimeOwnershipValues, buildRuntimeReadWhere, canManageCompanyOwnedAgent } from "@/lib/agent-access";
import { requireAuth } from "@/lib/require-auth";
import { getRequestOrigin } from "@/lib/runtime-callback-url";
import { deriveRuntimeTrustSummary } from "@/lib/runtime-trust";
import { resolveAccessibleWorkspace } from "@/lib/workspace";
import { normalizeHermesRootUrl } from "@/lib/runtimes/providers/hermes";
import { sealRuntimeAuthToken } from "@/lib/runtime-token-crypto";
import { toBrowserSafeRuntime } from "@/lib/runtime-api-dto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const access = await getAgentAccessContext();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });
    const where = buildRuntimeReadWhere(access);
    if (!where) return NextResponse.json([]);

    const runtimes = await withRetry(() => db!
      .select({
        id: companyRuntimes.id,
        runtimeType: companyRuntimes.runtimeType,
        name: companyRuntimes.name,
        gatewayUrl: companyRuntimes.gatewayUrl,
        httpUrl: companyRuntimes.httpUrl,
        isPrimary: companyRuntimes.isPrimary,
        status: companyRuntimes.status,
        lastPing: companyRuntimes.lastPing,
        metadata: companyRuntimes.metadata,
        createdAt: companyRuntimes.createdAt,
        updatedAt: companyRuntimes.updatedAt,
        ownerType: companyRuntimes.ownerType,
        ownerUserId: companyRuntimes.ownerUserId,
        ownerCompanyId: companyRuntimes.ownerCompanyId,
      })
      .from(companyRuntimes)
      .where(where));

    return NextResponse.json(
      runtimes.map((runtime) => ({
        ...runtime,
        capabilitySnapshot: readCapabilitySnapshot(runtime.metadata),
        trustSummary: deriveRuntimeTrustSummary(runtime),
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const access = await getAgentAccessContext();
    if (!access.userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json();
    const { name, gatewayUrl, httpUrl, authToken, runtimeType, metadata, ownerType, workspaceId, companyId, capabilitySnapshot } = body;
    const callbackBaseUrl = getRequestOrigin(request);

    if (!name || !gatewayUrl || !httpUrl) {
      return NextResponse.json({ error: "name, gatewayUrl, and httpUrl are required" }, { status: 400 });
    }
    if (authToken != null && typeof authToken !== "string") {
      return NextResponse.json({ error: "authToken must be a string" }, { status: 400 });
    }
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const targetWorkspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? access.activeCompanyId ?? null,
    });
    if (!targetWorkspace) {
      return NextResponse.json({ error: "Select a readable workspace first" }, { status: 400 });
    }

    if (ownerType === "company" && targetWorkspace.type !== "company") {
      return NextResponse.json({ error: "Company-owned runtimes must be created from a company workspace" }, { status: 400 });
    }

    const anchorCompanyId =
      targetWorkspace.companyId ??
      access.activeCompanyId ??
      access.memberships[0]?.companyId ??
      null;

    if (!anchorCompanyId && ownerType !== "company") {
      return NextResponse.json(
        { error: "Personal runtimes currently require at least one company membership for shared skill storage" },
        { status: 400 }
      );
    }

    const ownership = runtimeOwnershipValues({
      ownerType,
      userId: access.userId,
      activeCompanyId: targetWorkspace.type === "company" ? targetWorkspace.companyId : anchorCompanyId,
    });
    if (ownership.ownerType === "company" && !canManageCompanyOwnedAgent(access, ownership.ownerCompanyId)) {
      return NextResponse.json({ error: "Only company admins can create org-owned runtimes" }, { status: 403 });
    }

    const existing = await withRetry(() => db!
      .select({ id: companyRuntimes.id })
      .from(companyRuntimes)
      .where(buildRuntimePrimaryScopeWhere(ownership)));

    const isPrimary = existing.length === 0;

    const normalizedRuntime = normalizeRuntimeCreateInput({
      runtimeType,
      gatewayUrl,
      httpUrl,
      metadata: (metadata || {}) as Record<string, unknown>,
    });

    const [runtime] = await withRetry(() => db!
      .insert(companyRuntimes)
      .values({
        runtimeType: normalizedRuntime.runtimeType,
        name,
        gatewayUrl: normalizedRuntime.gatewayUrl,
        httpUrl: normalizedRuntime.httpUrl,
        authToken: sealRuntimeAuthToken(authToken),
        isPrimary,
        status: "connected",
        lastPing: new Date(),
        metadata: {
          ...normalizedRuntime.metadata,
          callbackBaseUrl,
          workspaceId: targetWorkspace.id,
          ...(capabilitySnapshot ? { capabilitySnapshot } : {}),
        },
        ...ownership,
      })
      .returning());

    return NextResponse.json({
      ...toBrowserSafeRuntime(runtime),
      capabilitySnapshot: readCapabilitySnapshot(runtime.metadata),
      trustSummary: deriveRuntimeTrustSummary(runtime),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildRuntimePrimaryScopeWhere(ownership: ReturnType<typeof runtimeOwnershipValues>) {
  if (ownership.ownerType === "user") {
    if (!ownership.ownerUserId) {
      throw new Error("Personal runtimes require an authenticated user");
    }

    return and(
      eq(companyRuntimes.ownerType, "user"),
      eq(companyRuntimes.ownerUserId, ownership.ownerUserId)
    );
  }

  return and(
    eq(companyRuntimes.ownerType, "company"),
    or(
      eq(companyRuntimes.ownerCompanyId, ownership.ownerCompanyId),
      and(
        isNull(companyRuntimes.ownerCompanyId),
        eq(companyRuntimes.companyId, ownership.companyId)
      )
    )
  );
}

function normalizeRuntimeCreateInput(params: {
  runtimeType?: string | null;
  gatewayUrl: string;
  httpUrl: string;
  metadata: Record<string, unknown>;
}) {
  if (params.runtimeType === "hermes") {
    const rootUrl = normalizeHermesRootUrl(params.httpUrl || params.gatewayUrl);
    return {
      runtimeType: "hermes",
      gatewayUrl: rootUrl,
      httpUrl: rootUrl,
      metadata: {
        ...params.metadata,
        provider: "hermes",
        apiBaseUrl: `${rootUrl}/v1`,
      },
    };
  }

  return {
    runtimeType: params.runtimeType || "openclaw",
    gatewayUrl: params.gatewayUrl,
    httpUrl: params.httpUrl,
    metadata: params.metadata,
  };
}

function readCapabilitySnapshot(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const snapshot = (metadata as Record<string, unknown>).capabilitySnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}
