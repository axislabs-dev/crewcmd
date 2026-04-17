import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAgentAccessContext, runtimeOwnershipValues, buildRuntimeReadWhere, canManageCompanyOwnedAgent } from "@/lib/agent-access";
import { getRequestOrigin } from "@/lib/runtime-callback-url";

export const dynamic = "force-dynamic";

export async function GET() {
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
        ownerType: companyRuntimes.ownerType,
        ownerUserId: companyRuntimes.ownerUserId,
        ownerCompanyId: companyRuntimes.ownerCompanyId,
      })
      .from(companyRuntimes)
      .where(where));

    return NextResponse.json(runtimes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await getAgentAccessContext();
    if (!access.userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json();
    const { name, gatewayUrl, httpUrl, authToken, runtimeType, metadata, ownerType } = body;
    const callbackBaseUrl = getRequestOrigin(request);

    if (!name || !gatewayUrl || !httpUrl) {
      return NextResponse.json({ error: "name, gatewayUrl, and httpUrl are required" }, { status: 400 });
    }
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    if (!access.activeCompanyId) return NextResponse.json({ error: "Select an active company first" }, { status: 400 });
    const ownership = runtimeOwnershipValues({ ownerType, userId: access.userId, activeCompanyId: access.activeCompanyId });
    if (ownership.ownerType === "company" && !canManageCompanyOwnedAgent(access, ownership.ownerCompanyId)) {
      return NextResponse.json({ error: "Only company admins can create org-owned runtimes" }, { status: 403 });
    }

    const existing = await withRetry(() => db!
      .select({ id: companyRuntimes.id })
      .from(companyRuntimes)
      .where(and(eq(companyRuntimes.companyId, access.activeCompanyId!), eq(companyRuntimes.ownerType, ownership.ownerType))));

    const isPrimary = existing.length === 0;

    const [runtime] = await withRetry(() => db!
      .insert(companyRuntimes)
      .values({
        runtimeType: runtimeType || "openclaw",
        name,
        gatewayUrl,
        httpUrl,
        authToken: authToken || null,
        isPrimary,
        status: "connected",
        lastPing: new Date(),
        metadata: {
          ...((metadata || {}) as Record<string, unknown>),
          callbackBaseUrl,
        },
        ...ownership,
      })
      .returning());

    return NextResponse.json(runtime);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
