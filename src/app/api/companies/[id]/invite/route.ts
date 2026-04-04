import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteTokens, companies } from "@/db/schema";
import { auth } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/companies/[id]/invite — generate an invite token + link */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json();
  const { email, role } = body;

  const validRoles = ["owner", "admin", "member", "viewer"];
  const inviteRole = validRoles.includes(role) ? role : "member";

  // Verify company exists
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(inviteTokens).values({
    companyId: id,
    token,
    email: email?.toLowerCase().trim() || null,
    role: inviteRole,
    createdBy: (session.user as Record<string, unknown>).id as string,
    expiresAt,
  });

  // Build invite link using request origin (self-hosted friendly)
  const xHost = request.headers.get("x-forwarded-host");
  const origin = xHost
    ? `${request.headers.get("x-forwarded-proto") || "https"}://${xHost}`
    : new URL(request.url).origin;
  const inviteLink = `${origin}/join?token=${token}`;

  return NextResponse.json({ ok: true, inviteLink, token });
}

/** GET /api/companies/[id]/invite — list pending invites */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!db) {
    return NextResponse.json([], { status: 200 });
  }

  const { id } = await params;

  const tokens = await db
    .select()
    .from(inviteTokens)
    .where(eq(inviteTokens.companyId, id));

  return NextResponse.json(tokens);
}
