/**
 * Agent Access Tiers — Schema Additions
 *
 * This file defines types and migration SQL for agent visibility / access grants.
 * The actual pgTable definitions should be merged into schema.ts later.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Agent visibility tiers controlling default access */
export type AgentVisibility = "private" | "assigned" | "team";

/** Row shape for the agent_access_grants table */
export interface AgentAccessGrant {
  id: string;
  agentId: string;
  userId: string;
  grantedBy: string;
  canInteract: boolean;
  canConfigure: boolean;
  canViewLogs: boolean;
  createdAt: Date;
}

/** Input for creating a new access grant */
export interface CreateAccessGrantInput {
  agentId: string;
  userId: string;
  grantedBy: string;
  canInteract?: boolean;
  canConfigure?: boolean;
  canViewLogs?: boolean;
}

/** Input for updating an existing access grant */
export interface UpdateAccessGrantInput {
  canInteract?: boolean;
  canConfigure?: boolean;
  canViewLogs?: boolean;
}

// ─── pgTable code to merge into schema.ts ─────────────────────────────────────
//
// Add to agents table:
//   visibility: text("visibility").notNull().default("team"),
//
// New table:
//
//   export const agentAccessGrants = pgTable("agent_access_grants", {
//     id: uuid("id").primaryKey().defaultRandom(),
//     agentId: uuid("agent_id")
//       .references(() => agents.id, { onDelete: "cascade" })
//       .notNull(),
//     userId: uuid("user_id")
//       .references(() => users.id, { onDelete: "cascade" })
//       .notNull(),
//     grantedBy: text("granted_by").notNull(),
//     canInteract: boolean("can_interact").notNull().default(true),
//     canConfigure: boolean("can_configure").notNull().default(false),
//     canViewLogs: boolean("can_view_logs").notNull().default(true),
//     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
//   });

// ─── Migration SQL ────────────────────────────────────────────────────────────

/** SQL migration to run against PGlite (or any Postgres) */
export const ACCESS_MIGRATION_SQL = `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';

  CREATE TABLE IF NOT EXISTS agent_access_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by text NOT NULL,
    can_interact boolean NOT NULL DEFAULT true,
    can_configure boolean NOT NULL DEFAULT false,
    can_view_logs boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_access_grants_agent ON agent_access_grants(agent_id);
  CREATE INDEX IF NOT EXISTS idx_access_grants_user ON agent_access_grants(user_id);
`;
