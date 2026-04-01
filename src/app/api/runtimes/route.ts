import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtimes — List all runtimes for the active company
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const companyId = cookieStore.get("active_company")?.value;
    if (!companyId) {
      return NextResponse.json({ error: "No active company" }, { status: 400 });
    }

    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const runtimes = await withRetry(() => db!
      .select({
        id: companyRuntimes.id,
        runtimeType: companyRuntimes.runtimeType,
        name: companyRuntimes.name,
        gatewayUrl: companyRuntimes.gatewayUrl,
        httpUrl: companyRuntimes.httpUrl,
        isPrimary: companyRuntimes.isPrimary,
        status: companyRuntimes.status,
        lastPing: companyRuntimes.lastPing,
        metadata: companyRuntimes.metadata,
        createdAt: companyRuntimes.createdAt,
      })
      .from(companyRuntimes)
      .where(eq(companyRuntimes.companyId, companyId)));

    return NextResponse.json(runtimes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/runtimes — Create a new runtime connection
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const companyId = cookieStore.get("active_company")?.value;
    if (!companyId) {
      return NextResponse.json({ error: "No active company" }, { status: 400 });
    }

    const body = await request.json();
    const { name, gatewayUrl, httpUrl, authToken, runtimeType, metadata } = body;

    if (!name || !gatewayUrl || !httpUrl) {
      return NextResponse.json(
        { error: "name, gatewayUrl, and httpUrl are required" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    // Check if this is the first runtime (make it primary)
    const existing = await withRetry(() => db!
      .select({ id: companyRuntimes.id })
      .from(companyRuntimes)
      .where(eq(companyRuntimes.companyId, companyId)));

    const isPrimary = existing.length === 0;

    const [runtime] = await withRetry(() => db!
      .insert(companyRuntimes)
      .values({
        companyId,
        runtimeType: runtimeType || "openclaw",
        name,
        gatewayUrl,
        httpUrl,
        authToken: authToken || null,
        isPrimary,
        status: "connected",
        lastPing: new Date(),
        metadata: metadata || null,
      })
      .returning());

    return NextResponse.json(runtime);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
