import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyMembers, mobilePushDevices } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

const VALID_PLATFORMS = new Set(["ios", "android"]);
const VALID_PROVIDERS = new Set(["apns", "fcm"]);

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(request);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  try {
    const body = await request.json();
    const companyId = asString(body.companyId) ?? request.cookies.get("active_company")?.value ?? null;
    const platform = asString(body.platform);
    const provider = asString(body.provider);
    const token = asString(body.token);
    const deviceId = asString(body.deviceId);
    const appId = asString(body.appId) ?? "crewcmd-mobile";

    if (!companyId || !platform || !provider || !token || !deviceId) {
      return NextResponse.json(
        { error: "companyId, platform, provider, token, and deviceId are required" },
        { status: 400 }
      );
    }
    if (!VALID_PLATFORMS.has(platform) || !VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Invalid platform or provider" }, { status: 400 });
    }

    const [membership] = await withRetry(() =>
      db!.select({ id: companyMembers.id })
        .from(companyMembers)
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
        .limit(1)
    );
    if (!membership) return NextResponse.json({ error: "Company access denied" }, { status: 403 });

    const now = new Date();
    const [existing] = await withRetry(() =>
      db!.select({ id: mobilePushDevices.id })
        .from(mobilePushDevices)
        .where(and(
          eq(mobilePushDevices.userId, user.id),
          eq(mobilePushDevices.companyId, companyId),
          eq(mobilePushDevices.deviceId, deviceId),
          eq(mobilePushDevices.appId, appId),
        ))
        .limit(1)
    );

    if (existing) {
      const [device] = await withRetry(() =>
        db!.update(mobilePushDevices)
          .set({ platform, provider, token, enabled: true, lastSeenAt: now, updatedAt: now })
          .where(eq(mobilePushDevices.id, existing.id))
          .returning()
      );
      return NextResponse.json({ device });
    }

    const [device] = await withRetry(() =>
      db!.insert(mobilePushDevices)
        .values({ userId: user.id, companyId, platform, provider, token, deviceId, appId })
        .returning()
    );
    return NextResponse.json({ device }, { status: 201 });
  } catch (error) {
    console.error("[api/mobile/push-devices] POST error:", error);
    return NextResponse.json({ error: "Failed to register push device" }, { status: 500 });
  }
}

