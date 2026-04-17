import { and, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents, companyRuntimes } from "@/db/schema";
import { canManageCompanyOwnedAgent, getAgentAccessContext } from "@/lib/agent-access";

export const dynamic = "force-dynamic";

export async function DELETE(
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
      const ownerCompanyId = runtime.ownerCompanyId ?? null;
      const ownerUserId = runtime.ownerUserId ?? null;
      const [replacement] = await withRetry(() =>
        db!
          .select({ id: companyRuntimes.id })
          .from(companyRuntimes)
          .where(
            and(
              eq(companyRuntimes.companyId, runtime.companyId),
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
