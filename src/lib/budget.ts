import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentBudgets, costEvents } from "@/db/schema";

export interface BudgetCheck {
  allowed: boolean;
  remaining: number;
  percentUsed: number;
  autoPause: boolean;
  alertThreshold: number;
}

export interface CostEventInput {
  agentId: string;
  companyId: string;
  taskId?: string | null;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Check whether an agent is within budget.
 * Returns budget status including remaining spend and percentage used.
 */
export async function checkBudget(
  agentId: string,
  companyId: string
): Promise<BudgetCheck | null> {
  if (!db) return null;

  const [budget] = await db
    .select()
    .from(agentBudgets)
    .where(
      and(
        eq(agentBudgets.agentId, agentId),
        eq(agentBudgets.companyId, companyId)
      )
    )
    .limit(1);

  if (!budget) return null;

  const limit = parseFloat(budget.monthlyLimit);
  const spend = parseFloat(budget.currentSpend);
  const remaining = Math.max(0, limit - spend);
  const percentUsed = limit > 0 ? (spend / limit) * 100 : 0;

  return {
    allowed: !budget.autoPause || spend < limit,
    remaining,
    percentUsed,
    autoPause: budget.autoPause,
    alertThreshold: budget.alertThreshold,
  };
}

/**
 * Record a cost event and update the agent's current spend.
 * Returns the inserted cost event and updated budget check.
 */
export async function recordCost(event: CostEventInput) {
  if (!db) return null;

  const [costEvent] = await db
    .insert(costEvents)
    .values({
      agentId: event.agentId,
      companyId: event.companyId,
      taskId: event.taskId || null,
      provider: event.provider,
      model: event.model,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costUsd: event.costUsd,
      metadata: event.metadata || null,
    })
    .returning();

  // Update current_spend on the agent's budget
  await db
    .update(agentBudgets)
    .set({
      currentSpend: sql`${agentBudgets.currentSpend}::numeric + ${event.costUsd}::numeric`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentBudgets.agentId, event.agentId),
        eq(agentBudgets.companyId, event.companyId)
      )
    );

  const budgetCheck = await checkBudget(event.agentId, event.companyId);

  return { costEvent, budgetCheck };
}

/**
 * Reset current_spend for all budgets where the billing period has elapsed.
 * Call this monthly (e.g. via cron).
 */
export async function resetBudgets() {
  if (!db) return [];

  const now = new Date();

  const expired = await db
    .select()
    .from(agentBudgets)
    .where(
      sql`${agentBudgets.periodStart} + interval '1 month' <= ${now}`
    );

  for (const budget of expired) {
    // Advance period_start by 1 month
    const newPeriodStart = new Date(budget.periodStart);
    newPeriodStart.setMonth(newPeriodStart.getMonth() + 1);

    await db
      .update(agentBudgets)
      .set({
        currentSpend: "0",
        periodStart: newPeriodStart,
        updatedAt: now,
      })
      .where(eq(agentBudgets.id, budget.id));
  }

  return expired.map((b) => b.id);
}

/**
 * Check if an agent should be auto-paused based on budget.
 */
export async function shouldAutoPause(
  agentId: string,
  companyId: string
): Promise<boolean> {
  const check = await checkBudget(agentId, companyId);
  if (!check) return false;
  return check.autoPause && check.percentUsed >= 100;
}
