import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import type { InboxMessage } from "@/db/schema-inbox";

export const dynamic = "force-dynamic";

/** Priority sort order: critical first */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Seed messages returned when a company has no inbox messages yet */
function getSeedMessages(companyId: string): InboxMessage[] {
  const now = new Date();
  const ago = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();

  return [
    {
      id: "seed-1",
      companyId,
      fromAgentId: "FORGE",
      toUserId: null,
      toAgentId: null,
      type: "decision",
      priority: "high",
      title: "Architecture choice: monorepo vs polyrepo for service extraction",
      body: "We're at a fork in the road with the payment service extraction. I've analyzed both approaches:\n\n**Monorepo (Turborepo)**\n- Easier shared types and validation\n- Single CI pipeline\n- Atomic cross-service changes\n\n**Polyrepo**\n- Independent deploy cycles\n- Cleaner ownership boundaries\n- Better for future team scaling\n\nGiven our current team size (3 agents, 2 humans), I'm leaning monorepo. But this is a hard-to-reverse decision — requesting human input.",
      context: { projectId: "proj-001", relatedAgents: ["FORGE", "CIPHER"] },
      actions: [
        { id: "a1", label: "Go Monorepo", style: "primary", action: "approve" },
        { id: "a2", label: "Go Polyrepo", style: "ghost", action: "approve" },
        { id: "a3", label: "Need More Info", style: "ghost", action: "snooze" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(12),
      updatedAt: ago(12),
    },
    {
      id: "seed-2",
      companyId,
      fromAgentId: "CIPHER",
      toUserId: null,
      toAgentId: null,
      type: "blocker",
      priority: "critical",
      title: "Missing API credentials for Stripe integration",
      body: "I'm blocked on the payment flow implementation. The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment variables are not set in the staging environment.\n\nI've checked:\n- `.env.example` — vars are documented\n- Vercel dashboard — not configured for staging\n- 1Password vault — no entry found\n\nNeed a human to provision these credentials and add them to the staging environment.",
      context: {
        taskId: "task-042",
        projectId: "proj-001",
        metadata: { blockedSince: ago(45) },
      },
      actions: [
        { id: "b1", label: "Credentials Added", style: "primary", action: "approve" },
        { id: "b2", label: "Reassign", style: "ghost", action: "reassign" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(45),
      updatedAt: ago(45),
    },
    {
      id: "seed-3",
      companyId,
      fromAgentId: "PULSE",
      toUserId: null,
      toAgentId: null,
      type: "completed",
      priority: "normal",
      title: "Database migration for user preferences table completed",
      body: "Migration `20260331_add_user_preferences` has been applied successfully to both staging and production.\n\n**Changes:**\n- Added `user_preferences` table (id, user_id, theme, notifications, locale)\n- Added index on `user_id`\n- Backfilled 1,247 existing users with default preferences\n\nNo downtime. All health checks passing.",
      context: { taskId: "task-038", projectId: "proj-002" },
      actions: [
        { id: "c1", label: "Acknowledge", style: "ghost", action: "dismiss" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(90),
      updatedAt: ago(90),
    },
    {
      id: "seed-4",
      companyId,
      fromAgentId: "RAZOR",
      toUserId: null,
      toAgentId: null,
      type: "question",
      priority: "normal",
      title: "Design direction: dark mode toggle placement",
      body: "Working on the settings redesign. Two options for the dark mode toggle:\n\n1. **Top nav bar** — always visible, quick access, but adds clutter to the nav\n2. **Settings page only** — cleaner nav, but users need to navigate to change it\n\nMost SaaS apps go with option 1. Our nav is already dense though. What's the preference?",
      context: { projectId: "proj-003", relatedAgents: ["RAZOR"] },
      actions: [
        { id: "d1", label: "Top Nav", style: "primary", action: "approve" },
        { id: "d2", label: "Settings Only", style: "ghost", action: "approve" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(180),
      updatedAt: ago(180),
    },
    {
      id: "seed-5",
      companyId,
      fromAgentId: "HAVOC",
      toUserId: null,
      toAgentId: null,
      type: "escalation",
      priority: "high",
      title: "Test suite failure rate spiked to 23% after dependency update",
      body: "After updating `@testing-library/react` from 14.x to 16.x, 47 out of 204 tests are failing.\n\n**Root cause:** The new version changed how `act()` warnings are handled. Tests that relied on implicit act wrapping now throw.\n\n**Options:**\n1. Roll back the dependency update (safe, fast)\n2. Fix the tests (correct, but ~2-3 hours of work)\n3. Suppress act warnings temporarily (not recommended)\n\nI'd normally just fix them, but this is blocking the release pipeline. Escalating for priority call.",
      context: {
        taskId: "task-051",
        metadata: { failingTests: 47, totalTests: 204, failRate: "23%" },
      },
      actions: [
        { id: "e1", label: "Roll Back", style: "danger", action: "approve" },
        { id: "e2", label: "Fix Tests", style: "primary", action: "approve" },
        { id: "e3", label: "Snooze 1h", style: "ghost", action: "snooze" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(8),
      updatedAt: ago(8),
    },
    {
      id: "seed-6",
      companyId,
      fromAgentId: "FORGE",
      toUserId: null,
      toAgentId: null,
      type: "approval",
      priority: "high",
      title: "Deploy v2.4.0 to production",
      body: "Release `v2.4.0` is ready for production deployment.\n\n**Changelog:**\n- feat: payment service extraction (FORGE)\n- feat: user preferences with dark mode (PULSE)\n- fix: race condition in webhook handler (CIPHER)\n- chore: dependency updates (HAVOC)\n\n**Staging verification:**\n- All 204 tests passing\n- Load test: p99 latency 142ms (within SLA)\n- Smoke tests: 12/12 passing\n- No new Sentry errors in 24h\n\nRequesting approval to proceed with production deploy.",
      context: {
        projectId: "proj-001",
        relatedAgents: ["FORGE", "PULSE", "CIPHER", "HAVOC"],
        metadata: { version: "2.4.0", environment: "production" },
      },
      actions: [
        { id: "f1", label: "Approve Deploy", style: "primary", action: "approve" },
        { id: "f2", label: "Reject", style: "danger", action: "reject" },
        { id: "f3", label: "Delay 24h", style: "ghost", action: "snooze" },
      ],
      status: "unread",
      actionedBy: null,
      actionedAt: null,
      actionResult: null,
      snoozeUntil: null,
      createdAt: ago(3),
      updatedAt: ago(3),
    },
  ];
}

/**
 * GET /api/inbox — List inbox messages for a company.
 * Query params: company_id, status, priority, type, limit, offset
 * Returns seed data if company has no messages.
 */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const conditions: string[] = [];
    if (companyId) conditions.push(`company_id = '${companyId}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `SELECT
          id,
          company_id AS "companyId",
          from_agent_id AS "fromAgentId",
          to_user_id AS "toUserId",
          to_agent_id AS "toAgentId",
          type,
          priority,
          title,
          body,
          context,
          actions,
          status,
          actioned_by AS "actionedBy",
          actioned_at AS "actionedAt",
          action_result AS "actionResult",
          snooze_until AS "snoozeUntil",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM inbox_messages
        ${where}
        ORDER BY created_at DESC`
      ))
    );

    const rows = (result.rows ?? []) as unknown as InboxMessage[];
    let messages: InboxMessage[] = [...rows];

    // If no messages exist for this company, return seed data
    if (messages.length === 0) {
      messages = getSeedMessages(companyId || "00000000-0000-0000-0000-000000000000");
    }

    // Apply filters
    if (status) {
      messages = messages.filter((m) => m.status === status);
    }
    if (priority) {
      messages = messages.filter((m) => m.priority === priority);
    }
    if (type) {
      messages = messages.filter((m) => m.type === type);
    }

    // Sort: priority (critical first), then createdAt desc
    messages.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Paginate
    const paginated = messages.slice(offset, offset + limit);

    return NextResponse.json(paginated);
  } catch (error) {
    console.error("[api/inbox] GET error:", error);
    // Fall back to seed data on any DB error (e.g. table doesn't exist yet)
    const seeds = getSeedMessages(companyId || "00000000-0000-0000-0000-000000000000");
    return NextResponse.json(seeds);
  }
}

/**
 * POST /api/inbox — Create a new inbox message.
 * Body: { companyId, fromAgentId, toUserId?, toAgentId?, type, priority, title, body, context?, actions? }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.companyId || !body.fromAgentId || !body.type || !body.title || !body.body) {
      return NextResponse.json(
        { error: "companyId, fromAgentId, type, title, and body are required" },
        { status: 400 }
      );
    }

    const validTypes = ["decision", "blocker", "completed", "question", "escalation", "update", "approval"];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
    }

    const validPriorities = ["critical", "high", "normal", "low"];
    const priorityVal = body.priority || "normal";
    if (!validPriorities.includes(priorityVal)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` },
        { status: 400 }
      );
    }

    const toUserId = body.toUserId ? `'${body.toUserId}'` : "NULL";
    const toAgentId = body.toAgentId ? `'${body.toAgentId}'` : "NULL";
    const contextVal = body.context ? `'${JSON.stringify(body.context).replace(/'/g, "''")}'::jsonb` : "NULL";
    const actionsVal = body.actions ? `'${JSON.stringify(body.actions).replace(/'/g, "''")}'::jsonb` : "NULL";

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        INSERT INTO inbox_messages (company_id, from_agent_id, to_user_id, to_agent_id, type, priority, title, body, context, actions)
        VALUES (
          '${body.companyId}',
          '${body.fromAgentId}',
          ${toUserId},
          ${toAgentId},
          '${body.type}',
          '${priorityVal}',
          '${String(body.title).replace(/'/g, "''")}',
          '${String(body.body).replace(/'/g, "''")}',
          ${contextVal},
          ${actionsVal}
        )
        RETURNING
          id,
          company_id AS "companyId",
          from_agent_id AS "fromAgentId",
          to_user_id AS "toUserId",
          to_agent_id AS "toAgentId",
          type, priority, title, body, context, actions, status,
          actioned_by AS "actionedBy",
          actioned_at AS "actionedAt",
          action_result AS "actionResult",
          snooze_until AS "snoozeUntil",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `))
    );

    const rows = (result.rows ?? []) as unknown as InboxMessage[];
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    console.error("[api/inbox] POST error:", error);
    return NextResponse.json({ error: "Failed to create inbox message" }, { status: 500 });
  }
}
