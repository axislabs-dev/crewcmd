import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { listAccessibleWorkspaces } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const user = await resolveCurrentUser(request);
  if (!user) {
    return NextResponse.json({ workspaces: [] }, { status: 200 });
  }

  const workspaces = await listAccessibleWorkspaces(user.id);
  return NextResponse.json({ workspaces });
}
