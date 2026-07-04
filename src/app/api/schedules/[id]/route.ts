import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { cronJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import {
  listCronJobsFromRuntime,
  resolvePrimaryReadableRuntimeForActiveWorkspace,
} from "@/lib/runtime-cron-sync";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { enabled } = body;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  try {
    const selectedRuntime = await resolvePrimaryReadableRuntimeForActiveWorkspace();
    if (!selectedRuntime) {
      return NextResponse.json({ error: "No connected runtime found" }, { status: 404 });
    }

    if (selectedRuntime.runtimeType === "hermes") {
      const provider = getRuntimeProvider(selectedRuntime.runtimeType);
      if (enabled && !provider.resumeJob) {
        return NextResponse.json(
          { error: `${provider.displayName} schedule resume is not supported yet` },
          { status: 501 }
        );
      }
      if (!enabled && !provider.pauseJob) {
        return NextResponse.json(
          { error: `${provider.displayName} schedule pause is not supported yet` },
          { status: 501 }
        );
      }

      const result = enabled
        ? await provider.resumeJob!(selectedRuntime, id)
        : await provider.pauseJob!(selectedRuntime, id);
      await updateCachedCronJobEnabled(id, enabled);
      return NextResponse.json({
        id: result.jobId,
        enabled,
        runtimeId: selectedRuntime.id,
        status: result.status,
        raw: result.raw,
      });
    }

    if (selectedRuntime.runtimeType !== "openclaw") {
      return NextResponse.json(
        { error: `${runtimeDisplayName(selectedRuntime.runtimeType)} schedule toggles are not supported yet` },
        { status: 501 }
      );
    }

    const { runtime, jobs } = await listCronJobsFromRuntime();
    if (!runtime) {
      return NextResponse.json({ error: "No connected runtime found" }, { status: 404 });
    }

    const target = jobs.find((job) => job.id === id);
    if (!target) {
      return NextResponse.json({ error: "Cron job not found on runtime" }, { status: 404 });
    }

    const meta = (runtime.metadata || {}) as Record<string, unknown>;
    const { GatewayClient, resolveDeviceIdentity } = await import("@/lib/gateway-client");
    const deviceKeyPem =
      typeof meta.devicePrivateKeyPem === "string" ? meta.devicePrivateKeyPem : undefined;
    const client = new GatewayClient(
      runtime.gatewayUrl,
      runtime.authToken || null,
      resolveDeviceIdentity(deviceKeyPem),
      15000
    );

    try {
      await client.connect();
      await client.cronUpdate({
        id,
        patch: { enabled },
      });
    } finally {
      client.close();
    }

    await updateCachedCronJobEnabled(id, enabled);

    return NextResponse.json({ id, enabled, runtimeId: runtime.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update schedule";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function updateCachedCronJobEnabled(id: string, enabled: boolean) {
  if (!db) return;
  await withRetry(() =>
    db!
      .update(cronJobs)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(cronJobs.id, id))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runtimeDisplayName(runtimeType: string | null | undefined) {
  if (runtimeType === "hermes") return "Hermes Agent API";
  return runtimeType || "Runtime";
}
