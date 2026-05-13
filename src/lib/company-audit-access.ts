import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyMembers, type companyRoleEnum } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/resolve-user";

export type CompanyRole = typeof companyRoleEnum.enumValues[number];

const AUDIT_READ_ROLES: CompanyRole[] = ["owner", "admin"];

/**
 * Audit and activity rows expose sensitive tenant/security state.
 * Until a dedicated auditor role exists, require explicit company owner/admin membership.
 * Bearer/service identities are intentionally not a global bypass: they must resolve to
 * a user with the required membership or they are denied before any audit rows are queried.
 */
export async function requireCompanyAuditReadAccess(
  request: NextRequest,
  companyId: string,
): Promise<NextResponse | null> {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const user = await resolveCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [membership] = await withRetry(() =>
    db!
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, user.id),
        ),
      )
      .limit(1),
  );

  if (!membership || !AUDIT_READ_ROLES.includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
