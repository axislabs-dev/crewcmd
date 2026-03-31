import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { companyMembers, users, companies } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/companies/[id]/members — list members of a company */
export async function GET(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { id } = await params;

  const members = await db
    .select({
      id: companyMembers.id,
      userId: companyMembers.userId,
      role: companyMembers.role,
      invitedBy: companyMembers.invitedBy,
      createdAt: companyMembers.createdAt,
      githubUsername: users.githubUsername,
      email: users.email,
    })
    .from(companyMembers)
    .innerJoin(users, eq(companyMembers.userId, users.id))
    .where(eq(companyMembers.companyId, id));

  return NextResponse.json(members);
}

/** POST /api/companies/[id]/members — invite a user to a company */
export async function POST(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  const identifier = body.email || body.githubUsername;
  if (!identifier) {
    return NextResponse.json({ error: "email or githubUsername is required" }, { status: 400 });
  }

  // Verify company exists
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Find or create the user record
  let [user] = body.email
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, body.email.toLowerCase())).limit(1)
    : await db.select({ id: users.id }).from(users).where(eq(users.githubUsername, body.githubUsername.toLowerCase())).limit(1);

  if (!user) {
    // Create a pending user record
    const email = (body.email || `${body.githubUsername}@pending.local`).toLowerCase();
    [user] = await db.insert(users).values({
      email,
      githubUsername: body.githubUsername?.toLowerCase() || null,
      role: "viewer",
      invitedBy: body.invitedBy || "system",
    }).returning({ id: users.id });
  }

  // Check if already a member
  const [existing] = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, id),
        eq(companyMembers.userId, user.id)
      )
    )
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: "User is already a member" }, { status: 409 });
  }

  const [member] = await db.insert(companyMembers).values({
    companyId: id,
    userId: user.id,
    role: body.role || "member",
    invitedBy: body.invitedBy || null,
  }).returning();

  return NextResponse.json(member, { status: 201 });
}

/** DELETE /api/companies/[id]/members — remove a member */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  if (!memberId) {
    return NextResponse.json({ error: "memberId query param required" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(companyMembers)
    .where(
      and(
        eq(companyMembers.id, memberId),
        eq(companyMembers.companyId, id)
      )
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
