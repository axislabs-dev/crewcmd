import { NextRequest, NextResponse } from "next/server";
import { syncCronJobsFromRuntime } from "@/lib/runtime-cron-sync";
import { getHeartbeatSecret } from "@/lib/heartbeat-secret";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = await getHeartbeatSecret();
  if (!secret) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncCronJobsFromRuntime();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/automations/sync] Error:", err);
    return NextResponse.json({ error: "Failed to sync from runtime" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await syncCronJobsFromRuntime();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/automations/sync] Error:", err);
    return NextResponse.json({ error: "Failed to sync from runtime" }, { status: 500 });
  }
}
