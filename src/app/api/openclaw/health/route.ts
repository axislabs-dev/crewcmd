import { NextRequest, NextResponse } from "next/server";
import { fetchHealth } from "@/lib/openclaw";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const health = await fetchHealth();

    if (health) {
      return NextResponse.json({ ...health, source: "live" });
    }

    return NextResponse.json({
      status: "unreachable",
      source: "offline",
    });
  } catch (err) {
    console.error("[api/openclaw/health] Error:", err);
    return NextResponse.json({
      status: "unreachable",
      source: "offline",
    });
  }
}
