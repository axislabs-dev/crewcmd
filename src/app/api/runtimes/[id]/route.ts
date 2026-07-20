import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents, companyRuntimes, cronJobs } from "@/db/schema";
import { canManageCompanyOwnedAgent, getAgentAccessContext } from "@/lib/agent-access";
import {
  cleanupCrewCmdRuntimeOperatingLayer,
} from "@/lib/runtime-operating-layer";
import {
  deleteRuntimeManagedResources,
  listRuntimeManagedResources,
} from "@/lib/runtime-managed-resources";
import { toBrowserSafeRuntime } from "@/lib/runtime-api-dto";
import { probeGateway, resolveDeviceIdentity } from "@/lib/gateway-client";
import {
  sealRuntimeDevicePrivateKey,
  storeRuntimeDeviceAuth,
} from "@/lib/runtime-device-auth";
import {
  isEncryptedRuntimeAuthToken,
  sealRuntimeAuthToken,
} from "@/lib/runtime-token-crypto";

export const dynamic = "force-dynamic";
const MAX_AUTH_TOKEN_LENGTH = 16_384;
const MAX_SEALED_DEVICE_KEY_LENGTH = 16_384;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const [runtime] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(eq(companyRuntimes.id, id))
        .limit(1)
    );

    if (!runtime) {
      return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
    }

    const canRead = runtime.ownerType === "user"
      ? runtime.ownerUserId === access.userId
      : canManageCompanyOwnedAgent(access, runtime.ownerCompanyId ?? runtime.companyId);

    if (!canRead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      ...toBrowserSafeRuntime(runtime),
      capabilitySnapshot: readCapabilitySnapshot(runtime.metadata),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || body.action !== "reauthenticate") {
      return NextResponse.json(
        { error: 'Unsupported action. Use "reauthenticate".' },
        { status: 400 }
      );
    }

    const authToken = typeof body.authToken === "string" ? body.authToken.trim() : "";
    if (!authToken) {
      return NextResponse.json({ error: "Gateway auth token is required" }, { status: 400 });
    }
    if (authToken.length > MAX_AUTH_TOKEN_LENGTH) {
      return NextResponse.json({ error: "Gateway auth token is too long" }, { status: 400 });
    }

    const suppliedDeviceKey = typeof body.deviceKeyPem === "string"
      ? body.deviceKeyPem.trim()
      : "";
    if (
      suppliedDeviceKey
      && (
        suppliedDeviceKey.length > MAX_SEALED_DEVICE_KEY_LENGTH
        || !isEncryptedRuntimeAuthToken(suppliedDeviceKey)
      )
    ) {
      return NextResponse.json({ error: "Invalid pending device identity" }, { status: 400 });
    }

    const { id } = await params;
    const [runtime] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(eq(companyRuntimes.id, id))
        .limit(1)
    );

    if (!runtime) {
      return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
    }

    const canReauthenticate = runtime.ownerType === "user"
      ? runtime.ownerUserId === access.userId
      : canManageCompanyOwnedAgent(access, runtime.ownerCompanyId ?? runtime.companyId);
    if (!canReauthenticate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (runtime.runtimeType !== "openclaw") {
      return NextResponse.json(
        { error: "Re-authentication is currently supported only for OpenClaw runtimes" },
        { status: 400 }
      );
    }
    if (!runtime.gatewayUrl) {
      return NextResponse.json({ error: "Runtime has no gateway URL" }, { status: 400 });
    }

    const metadata = runtime.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
      ? { ...(runtime.metadata as Record<string, unknown>) }
      : {};
    const storedDeviceKey = typeof metadata.devicePrivateKeyPem === "string"
      ? metadata.devicePrivateKeyPem
      : undefined;
    const result = await probeGateway(
      runtime.gatewayUrl,
      authToken,
      storedDeviceKey ?? (suppliedDeviceKey || undefined)
    );

    if (!result.ok) {
      if (result.error === "pairing_required" && result.devicePrivateKeyPem) {
        return NextResponse.json(
          {
            error: "OpenClaw device approval is required",
            code: "PAIRING_REQUIRED",
            pairingRequired: true,
            pairingInstructions: result.pairingInstructions,
            deviceKeyPem: sealRuntimeDevicePrivateKey(result.devicePrivateKeyPem),
          },
          { status: 409 }
        );
      }

      const message = result.error || "Failed to authenticate with OpenClaw";
      const status = /unauthorized|token mismatch|auth token/i.test(message) ? 401 : 502;
      return NextResponse.json(
        { error: message, code: "RUNTIME_REAUTHENTICATION_FAILED" },
        { status }
      );
    }

    if (!result.devicePrivateKeyPem) {
      return NextResponse.json(
        { error: "OpenClaw did not return a reusable device identity" },
        { status: 502 }
      );
    }

    let nextMetadata: Record<string, unknown> = {
      ...metadata,
      devicePrivateKeyPem: sealRuntimeDevicePrivateKey(result.devicePrivateKeyPem),
    };
    if (result.deviceAuth) {
      const device = resolveDeviceIdentity(result.devicePrivateKeyPem);
      nextMetadata = storeRuntimeDeviceAuth(
        nextMetadata,
        device.deviceId,
        result.deviceAuth,
      );
    }

    const sealedAuthToken = sealRuntimeAuthToken(authToken);
    if (!sealedAuthToken) {
      return NextResponse.json({ error: "Gateway auth token is required" }, { status: 400 });
    }

    const now = new Date();
    await withRetry(() =>
      db!
        .update(companyRuntimes)
        .set({
          authToken: sealedAuthToken,
          metadata: nextMetadata,
          status: "connected",
          lastPing: now,
          updatedAt: now,
        })
        .where(eq(companyRuntimes.id, id))
    );

    return NextResponse.json({
      ok: true,
      authenticationMode: result.deviceAuth ? "paired-device" : "local-shared-token",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const cleanupMode = new URL(request.url).searchParams.get("cleanup") ?? "remote";
    if (cleanupMode !== "remote" && cleanupMode !== "skip") {
      return NextResponse.json(
        { error: 'Invalid cleanup mode. Use "remote" or "skip".' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const [runtime] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(eq(companyRuntimes.id, id))
        .limit(1)
    );

    if (!runtime) {
      return NextResponse.json({ error: "Runtime not found" }, { status: 404 });
    }

    const canDelete = runtime.ownerType === "user"
      ? runtime.ownerUserId === access.userId
      : canManageCompanyOwnedAgent(access, runtime.ownerCompanyId ?? runtime.companyId);

    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const linkedAgents = await withRetry(() =>
      db!
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.runtimeId, id))
    );
    const managedResources = await listRuntimeManagedResources(id);
    const cronResourceIds = managedResources
      .filter((resource) => resource.resourceType === "cron-job" && resource.externalId)
      .map((resource) => resource.externalId!) ;

    if (cleanupMode === "remote") {
      try {
        await cleanupCrewCmdRuntimeOperatingLayer(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown cleanup error";
        return NextResponse.json(
          {
            error: `CrewCMD could not clean up the runtime in OpenClaw: ${message}`,
            code: "RUNTIME_CLEANUP_FAILED",
            canSkipCleanup: true,
            linkedAgents: linkedAgents.length,
            managedResources: managedResources.length,
          },
          { status: 409 }
        );
      }
    }

    await deleteRuntimeManagedResources(id);

    if (cronResourceIds.length > 0) {
      await withRetry(() =>
        db!.delete(cronJobs).where(
          cronResourceIds.length === 1
            ? eq(cronJobs.id, cronResourceIds[0])
            : inArray(cronJobs.id, cronResourceIds)
        )
      );
    }

    if (linkedAgents.length > 0) {
      await withRetry(() =>
        db!
          .update(agents)
          .set({
            runtimeId: null,
            status: "offline",
          })
          .where(eq(agents.runtimeId, id))
      );
    }

    if (runtime.isPrimary) {
      const runtimeCompanyId = runtime.companyId ?? null;
      const ownerCompanyId = runtime.ownerCompanyId ?? null;
      const ownerUserId = runtime.ownerUserId ?? null;
      const [replacement] = await withRetry(() =>
        db!
          .select({ id: companyRuntimes.id })
          .from(companyRuntimes)
          .where(
            and(
              runtimeCompanyId
                ? eq(companyRuntimes.companyId, runtimeCompanyId)
                : isNull(companyRuntimes.companyId),
              ne(companyRuntimes.id, id),
              eq(companyRuntimes.ownerType, runtime.ownerType),
              ownerCompanyId
                ? eq(companyRuntimes.ownerCompanyId, ownerCompanyId)
                : isNull(companyRuntimes.ownerCompanyId),
              ownerUserId
                ? eq(companyRuntimes.ownerUserId, ownerUserId)
                : isNull(companyRuntimes.ownerUserId)
            )
          )
          .limit(1)
      );

      if (replacement) {
        await withRetry(() =>
          db!
            .update(companyRuntimes)
            .set({ isPrimary: true })
            .where(eq(companyRuntimes.id, replacement.id))
        );
      }
    }

    await withRetry(() =>
      db!.delete(companyRuntimes).where(eq(companyRuntimes.id, id))
    );

    return NextResponse.json({
      ok: true,
      detachedAgents: linkedAgents.length,
      cleanupSkipped: cleanupMode === "skip",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function readCapabilitySnapshot(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const snapshot = (metadata as Record<string, unknown>).capabilitySnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}
