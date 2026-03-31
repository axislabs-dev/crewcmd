/**
 * Inbox Messages Schema — Agent-Human Communication Hub
 *
 * This file contains type definitions and migration SQL for the inbox_messages table.
 * The pgTable definition is provided as a comment block for merging into schema.ts.
 */

// ─── Type Definitions ─────────────────────────────────────────────────

/** Message types that agents can send to the inbox */
export type InboxMessageType =
  | "decision"
  | "blocker"
  | "completed"
  | "question"
  | "escalation"
  | "update"
  | "approval";

/** Priority levels for inbox messages */
export type InboxPriority = "critical" | "high" | "normal" | "low";

/** Status of an inbox message */
export type InboxStatus = "unread" | "read" | "actioned" | "snoozed" | "dismissed";

/** Action button style */
export type InboxActionStyle = "primary" | "danger" | "ghost";

/** Action button definition rendered on an inbox message */
export interface InboxAction {
  id: string;
  label: string;
  style: InboxActionStyle;
  action: "approve" | "reject" | "reassign" | "snooze" | "dismiss" | "custom";
  payload?: Record<string, unknown>;
}

/** Context attached to an inbox message linking it to other entities */
export interface InboxMessageContext {
  taskId?: string;
  projectId?: string;
  relatedAgents?: string[];
  metadata?: Record<string, unknown>;
}

/** Full inbox message record */
export interface InboxMessage {
  id: string;
  companyId: string;
  fromAgentId: string;
  toUserId: string | null;
  toAgentId: string | null;
  type: InboxMessageType;
  priority: InboxPriority;
  title: string;
  body: string;
  context: InboxMessageContext | null;
  actions: InboxAction[] | null;
  status: InboxStatus;
  actionedBy: string | null;
  actionedAt: string | null;
  actionResult: string | null;
  snoozeUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Stats response from /api/inbox/stats */
export interface InboxStats {
  total: number;
  byPriority: Record<InboxPriority, number>;
  byType: Record<InboxMessageType, number>;
}

// ─── pgTable Definition (merge into schema.ts) ───────────────────────
//
// Add these enums:
//
//   export const inboxMessageTypeEnum = pgEnum("inbox_message_type", [
//     "decision", "blocker", "completed", "question", "escalation", "update", "approval",
//   ]);
//
//   export const inboxPriorityEnum = pgEnum("inbox_priority", [
//     "critical", "high", "normal", "low",
//   ]);
//
//   export const inboxStatusEnum = pgEnum("inbox_status", [
//     "unread", "read", "actioned", "snoozed", "dismissed",
//   ]);
//
// Add this table:
//
//   export const inboxMessages = pgTable("inbox_messages", {
//     id: uuid("id").primaryKey().defaultRandom(),
//     companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
//     fromAgentId: text("from_agent_id").notNull(),
//     toUserId: uuid("to_user_id"),
//     toAgentId: text("to_agent_id"),
//     type: inboxMessageTypeEnum("type").notNull(),
//     priority: inboxPriorityEnum("priority").notNull().default("normal"),
//     title: text("title").notNull(),
//     body: text("body").notNull(),
//     context: jsonb("context").$type<InboxMessageContext>(),
//     actions: jsonb("actions").$type<InboxAction[]>(),
//     status: inboxStatusEnum("status").notNull().default("unread"),
//     actionedBy: text("actioned_by"),
//     actionedAt: timestamp("actioned_at", { withTimezone: true }),
//     actionResult: text("action_result"),
//     snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
//     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
//     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
//   });

// ─── Migration SQL ────────────────────────────────────────────────────

/** SQL to create the inbox_messages table and its enums in PGlite */
export const INBOX_MIGRATION_SQL = `
-- Enums
DO $$ BEGIN
  CREATE TYPE inbox_message_type AS ENUM ('decision','blocker','completed','question','escalation','update','approval');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE inbox_priority AS ENUM ('critical','high','normal','low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE inbox_status AS ENUM ('unread','read','actioned','snoozed','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table
CREATE TABLE IF NOT EXISTS inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL,
  to_user_id UUID,
  to_agent_id TEXT,
  type inbox_message_type NOT NULL,
  priority inbox_priority NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  context JSONB,
  actions JSONB,
  status inbox_status NOT NULL DEFAULT 'unread',
  actioned_by TEXT,
  actioned_at TIMESTAMPTZ,
  action_result TEXT,
  snooze_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inbox_company_status ON inbox_messages(company_id, status);
CREATE INDEX IF NOT EXISTS idx_inbox_company_priority ON inbox_messages(company_id, priority);
CREATE INDEX IF NOT EXISTS idx_inbox_to_user ON inbox_messages(to_user_id) WHERE to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages(created_at DESC);
`;
