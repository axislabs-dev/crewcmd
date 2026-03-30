import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { companies, companyMembers, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Get the active company for the current request.
 * Reads company_id from X-Company-Id header or `active_company` cookie.
 * Validates the current user is a member of that company.
 * Returns the company record, or null if no company is selected.
 * Throws a 403 response if user is not a member of the requested company.
 */
export async function getActiveCompany(req?: NextRequest) {
  if (!db) return null;

  const session = await auth();
  if (!session?.user) return null;

  const username = (session.user as Record<string, unknown>).username as string | undefined;
  if (!username) return null;

  // Resolve user id from username
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubUsername, username))
    .limit(1);
  if (!user) return null;

  // Get company_id from header or cookie
  let companyId: string | null = null;

  if (req) {
    companyId = req.headers.get("x-company-id");
  }

  if (!companyId) {
    const cookieStore = await cookies();
    companyId = cookieStore.get("active_company")?.value ?? null;
  }

  if (!companyId) return null;

  // Validate membership
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, user.id)
      )
    )
    .limit(1);

  if (!membership) return null;

  // Fetch the company
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return company ?? null;
}

/**
 * Require an active company and valid membership.
 * Returns a 403 NextResponse if validation fails, null if OK.
 */
export async function requireCompany(req: NextRequest): Promise<
  { company: typeof companies.$inferSelect; error: null } |
  { company: null; error: NextResponse }
> {
  const company = await getActiveCompany(req);
  if (!company) {
    return {
      company: null,
      error: NextResponse.json(
        { error: "No active company or not a member" },
        { status: 403 }
      ),
    };
  }
  return { company, error: null };
}
