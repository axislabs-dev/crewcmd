import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyMembers, users } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/companies — list companies the current user belongs to */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const session = await auth();
  const username = (session?.user as Record<string, unknown> | undefined)?.username as string | undefined;
  if (!username) return NextResponse.json([]);

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubUsername, username))
    .limit(1);
  if (!user) return NextResponse.json([]);

  // Get all companies this user is a member of
  const memberships = await db
    .select({
      company: companies,
      role: companyMembers.role,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(eq(companyMembers.userId, user.id));

  const result = memberships.map((m) => ({
    ...m.company,
    memberRole: m.role,
  }));

  return NextResponse.json(result);
}

/** POST /api/companies — create a new company */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const session = await auth();
  const username = (session?.user as Record<string, unknown> | undefined)?.username as string | undefined;
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubUsername, username))
    .limit(1);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await request.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [company] = await db.insert(companies).values({
    name: body.name,
    mission: body.mission || null,
    logoUrl: body.logoUrl || null,
    settings: body.settings || null,
    createdBy: username,
  }).returning();

  // Add creator as owner
  await db.insert(companyMembers).values({
    companyId: company.id,
    userId: user.id,
    role: "owner",
    invitedBy: username,
  });

  return NextResponse.json(company, { status: 201 });
}
