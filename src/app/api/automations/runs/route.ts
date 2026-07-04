import { NextRequest, NextResponse } from "next/server";
import {
  listCronJobsFromRuntime,
  resolvePrimaryReadableRuntimeForActiveWorkspace,
} from "@/lib/runtime-cron-sync";
import { GatewayClient, resolveDeviceIdentity } from "@/lib/gateway-client";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const jobId = req.nextUrl.searchParams.get("job_id");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 100);

  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  try {
    const selectedRuntime = await resolvePrimaryReadableRuntimeForActiveWorkspace();
    if (!selectedRuntime) {
      return NextResponse.json({ runs: [] });
    }
    if (selectedRuntime.runtimeType !== "openclaw") {
      return NextResponse.json(
        {
          runs: [],
          unsupported: true,
          error: `${runtimeDisplayName(selectedRuntime.runtimeType)} run history is not supported yet`,
        },
        { status: 501 }
      );
    }

    const { runtime } = await listCronJobsFromRuntime();
    if (!runtime) {
      return NextResponse.json({ runs: [] });
    }

    const meta = (runtime.metadata || {}) as Record<string, unknown>;
    const deviceKeyPem =
      typeof meta.devicePrivateKeyPem === "string" ? meta.devicePrivateKeyPem : undefined;
    const client = new GatewayClient(
      runtime.gatewayUrl,
      runtime.authToken || null,
      resolveDeviceIdentity(deviceKeyPem),
      15000
    );

    let runs: Array<Record<string, unknown>> = [];
    try {
      await client.connect();
      const result = await client.cronRuns({ id: jobId, limit });
      runs = Array.isArray(result.runs) ? result.runs : [];
    } finally {
      client.close();
    }

    return NextResponse.json({ runs });
  } catch (err) {
    console.error("[api/automations/runs] Error:", err);
    return NextResponse.json({ error: "Failed to read run history" }, { status: 500 });
  }
}

function runtimeDisplayName(runtimeType: string | null | undefined) {
  if (runtimeType === "hermes") return "Hermes Agent API";
  return runtimeType || "Runtime";
}
