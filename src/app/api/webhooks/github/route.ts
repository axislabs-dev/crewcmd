import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

/**
 * Validate GitHub webhook signature (x-hub-signature-256)
 */
async function validateSignature(request: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks/github] GITHUB_WEBHOOK_SECRET is not configured");
    return false;
  }

  const signature = request.headers.get("x-hub-signature-256");
  if (!signature) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Read raw body for signature validation
  const rawBody = await request.text();

  // Validate signature
  const valid = await validateSignature(request, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse event type
  const event = request.headers.get("x-github-event");
  if (event !== "pull_request") {
    // Acknowledge but ignore non-PR events
    return NextResponse.json({ ok: true, message: `Ignored event: ${event}` });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const action = payload.action as string;
  if (action !== "opened" && action !== "reopened") {
    return NextResponse.json({ ok: true, message: `Ignored action: ${action}` });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Extract PR fields
  const pr = payload.pull_request as Record<string, unknown>;
  if (!pr) {
    return NextResponse.json({ error: "Missing pull_request in payload" }, { status: 400 });
  }

  const head = pr.head as Record<string, unknown>;
  const base = pr.base as Record<string, unknown>;
  const baseRepo = base?.repo as Record<string, unknown>;

  const prUrl = pr.html_url as string;
  const branch = head?.ref as string;
  const repo = baseRepo?.full_name as string;
  const title = pr.title as string;
  const body = pr.body as string | null;

  if (!prUrl || !branch || !repo) {
    return NextResponse.json({ error: "Missing required PR fields" }, { status: 400 });
  }

  try {
    // Idempotency check: skip if a task with this prUrl already exists
    const existing = await withRetry(() =>
      db!.select().from(schema.tasks).where(eq(schema.tasks.prUrl, prUrl))
    );

    if (existing.length > 0) {
      return NextResponse.json({
        ok: true,
        message: "Task already exists for this PR",
        taskId: existing[0].id,
      });
    }

    // Create the review task for Sentinel
    const taskTitle = `Review PR: ${branch}`;
    const description = [
      `**Repo:** ${repo}`,
      `**Branch:** ${branch}`,
      `**PR Title:** ${title}`,
      body ? `\n**PR Description:**\n${body}` : "",
      `\n**PR URL:** ${prUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    const [task] = await db!
      .insert(schema.tasks)
      .values({
        title: taskTitle,
        description,
        status: "queued",
        priority: "high",
        assignedAgentId: "agent-sentinel",
        prUrl,
        branch,
        repo,
        createdBy: "webhook:github",
      })
      .returning();

    // Log activity
    await db!
      .insert(schema.activityLog)
      .values({
        agentId: "webhook:github",
        actionType: "create",
        description: `Auto-created Sentinel review task for PR: ${branch} (${repo})`,
        metadata: { taskId: task.id, prUrl, branch, repo },
      })
      .catch(() => {});

    console.log(`[webhooks/github] Created review task ${task.id} for PR ${prUrl}`);

    return NextResponse.json({ ok: true, taskId: task.id }, { status: 201 });
  } catch (error) {
    console.error("[webhooks/github] Error creating task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
