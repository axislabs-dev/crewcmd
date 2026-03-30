import { NextResponse } from "next/server";
import { fetchHealth } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

export async function GET() {
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
