import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyMembers } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
type CompanyMemberRole = "owner" | "admin" | "member" | "viewer";

async function getCompanyRole(request: NextRequest, companyId: string): Promise<CompanyMemberRole | null> {
  if (!db) return null;
  const user = await resolveCurrentUser(request);
  if (!user) return null;
  const [membership] = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
    .limit(1);
  return membership?.role ?? null;
}

function mergeSettings(existing: unknown, next: unknown) {
  const current = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  const incoming = next && typeof next === "object" && !Array.isArray(next)
    ? next as Record<string, unknown>
    : {};
  return { ...current, ...incoming };
}

/** GET /api/companies/[id] */
export async function GET(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const role = await getCompanyRole(request, id);
  if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(company);
}

/** PATCH /api/companies/[id] */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const role = await getCompanyRole(request, id);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.mission !== undefined) updates.mission = body.mission;
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;
  if (body.settings !== undefined) updates.settings = mergeSettings(company.settings, body.settings);

  const [updated] = await db
    .update(companies)
    .set(updates)
    .where(eq(companies.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

/** DELETE /api/companies/[id] */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const [deleted] = await db
    .delete(companies)
    .where(eq(companies.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
