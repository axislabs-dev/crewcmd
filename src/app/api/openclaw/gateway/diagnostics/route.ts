import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayDiagnosticsForRuntimes } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const where = buildRuntimeReadWhere(access);
    const runtimes = where
      ? await withRetry(() =>
          db!
            .select({
              id: companyRuntimes.id,
              gatewayUrl: companyRuntimes.gatewayUrl,
              authToken: companyRuntimes.authToken,
              metadata: companyRuntimes.metadata,
              isPrimary: companyRuntimes.isPrimary,
              status: companyRuntimes.status,
              lastPing: companyRuntimes.lastPing,
              updatedAt: companyRuntimes.updatedAt,
            })
            .from(companyRuntimes)
            .where(where)
        )
      : [];

    return NextResponse.json(getGatewayDiagnosticsForRuntimes(runtimes));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
