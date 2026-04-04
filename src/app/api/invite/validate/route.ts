import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteTokens, companies } from "@/db/schema";

export const dynamic = "force-dynamic";

/** GET /api/invite/validate?token=xxx — validate an invite token (no auth required) */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const [invite] = await db
    .select({
      id: inviteTokens.id,
      companyId: inviteTokens.companyId,
      email: inviteTokens.email,
      role: inviteTokens.role,
      expiresAt: inviteTokens.expiresAt,
      acceptedAt: inviteTokens.acceptedAt,
    })
    .from(inviteTokens)
    .where(eq(inviteTokens.token, token))
    .limit(1);

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }

  // Fetch company name
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, invite.companyId))
    .limit(1);

  return NextResponse.json({
    companyName: company?.name || "Unknown",
    email: invite.email,
    role: invite.role,
    expired: invite.expiresAt < new Date(),
    alreadyAccepted: !!invite.acceptedAt,
  });
}
