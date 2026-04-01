import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  boolean,
  serial,
  numeric,
} from "drizzle-orm/pg-core";

// ─── Multi-tenancy enums ───────────────────────────────────────────────

export const companyRoleEnum = pgEnum("company_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "active",
  "completed",
  "paused",
  "cancelled",
]);

// ─── Governance enums ─────────────────────────────────────────────────

export const gateTypeEnum = pgEnum("gate_type", [
  "agent_hire",
  "strategy_change",
  "budget_increase",
  "config_change",
  "task_escalation",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

// ─── Heartbeat & Escalation enums ────────────────────────────────────

export const heartbeatExecutionStatusEnum = pgEnum("heartbeat_execution_status", [
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

export const escalationTriggerEnum = pgEnum("escalation_trigger", [
  "blocked_task",
  "budget_exceeded",
  "heartbeat_failed",
  "approval_timeout",
  "agent_offline",
]);

// ─── Companies ─────────────────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  mission: text("mission"),
  logoUrl: text("logo_url"),
  settings: jsonb("settings").$type<Record<string, unknown>>(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Company Members ───────────────────────────────────────────────────

export const companyMembers = pgTable("company_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  role: companyRoleEnum("role").notNull().default("member"),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Goals ─────────────────────────────────────────────────────────────

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  parentGoalId: uuid("parent_goal_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: goalStatusEnum("status").notNull().default("active"),
  ownerAgentId: text("owner_agent_id"),
  sortIndex: integer("sort_index").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "viewer",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  githubUsername: text("github_username").unique(),
  githubId: text("github_id"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("viewer"),
  invitedBy: text("invited_by"),
  inviteToken: text("invite_token").unique(),
  invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentStatusEnum = pgEnum("agent_status", [
  "online",
  "idle",
  "working",
  "offline",
]);

export const taskSourceEnum = pgEnum("task_source", [
  "manual",
  "error_log",
  "test_failure",
  "ui_scan",
  "ci_failure",
  "agent_initiative",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "inbox",
  "queued",
  "assigned",
  "in_progress",
  "review",
  "done",
  "failed",
  "todo",
  "blocked",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "completed",
  "archived",
]);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  callsign: text("callsign").notNull().unique(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  emoji: text("emoji").notNull(),
  color: text("color").notNull(),
  status: agentStatusEnum("status").notNull().default("offline"),
  currentTask: text("current_task"),
  lastActive: timestamp("last_active").defaultNow(),
  reportsTo: text("reports_to"),
  soulContent: text("soul_content"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  adapterType: text("adapter_type").notNull().default("openclaw_gateway"),
  adapterConfig: jsonb("adapter_config").$type<Record<string, unknown>>().default({}),
  provider: text("provider"), // "anthropic" | "openai" | "google" | "openrouter" | null
  role: text("role").default("engineer"),
  model: text("model"),
  workspacePath: text("workspace_path"),
  runtimeConfig: jsonb("runtime_config").$type<Record<string, unknown>>().default({}),
  visibility: text("visibility").notNull().default("team"), // private | assigned | team
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#00f0ff"),
  status: projectStatusEnum("status").notNull().default("active"),
  ownerAgentId: text("owner_agent_id"),
  documents: jsonb("documents").$type<{ name: string; url: string }[]>(),
  context: text("context"),
  contextUpdatedAt: timestamp("context_updated_at", { withTimezone: true }),
  contextUpdatedBy: text("context_updated_by"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const prStatusEnum = pgEnum("pr_status", [
  "open",
  "changes_requested",
  "approved",
  "merged",
  "closed_duplicate",
  "closed",
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  shortId: serial("short_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("inbox"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  assignedAgentId: text("assigned_agent_id"),
  humanAssignee: text("human_assignee"),
  projectId: uuid("project_id").references(() => projects.id),
  prUrl: text("pr_url"),
  prStatus: prStatusEnum("pr_status"),
  branch: text("branch"),
  repo: text("repo"),
  reviewNotes: text("review_notes"),
  reviewCycleCount: integer("review_cycle_count").default(0).notNull(),
  sortIndex: integer("sort_index").default(0).notNull(),
  source: taskSourceEnum("source").notNull().default("manual"),
  errorHash: text("error_hash").unique(),
  createdBy: text("created_by"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  images: jsonb("images").$type<{ url: string; filename: string; uploadedAt: string }[]>().default([]).notNull(),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id"),
  actionType: text("action_type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taskComments = pgTable("task_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .references(() => tasks.id)
    .notNull(),
  agentId: text("agent_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentHeartbeats = pgTable("agent_heartbeats", {
  agentId: text("agent_id").primaryKey(),
  callsign: text("callsign").notNull(),
  status: text("status").notNull(),
  currentTask: text("current_task"),
  lastActive: timestamp("last_active", { withTimezone: true }).notNull(),
  sessionCount: integer("session_count").default(0).notNull(),
  rawData: jsonb("raw_data"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cronJobs = pgTable("cron_jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  status: text("status").notNull().default("ok"),
  enabled: boolean("enabled").notNull().default(true),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  target: text("target"),
  raw: jsonb("raw"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const nodeStatus = pgTable("node_status", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("unknown"),
  platform: text("platform"),
  version: text("version"),
  remoteIp: text("remote_ip"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  raw: jsonb("raw"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const docTypeEnum = pgEnum("doc_type", [
  "sop",
  "guide",
  "reference",
  "runbook",
  "general",
]);

export const docVisibilityEnum = pgEnum("doc_visibility", [
  "company",
  "project",
  "agents_only",
]);

export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  docType: docTypeEnum("doc_type").default("general").notNull(),
  visibility: docVisibilityEnum("visibility").default("company").notNull(),
  authorAgentId: text("author_agent_id"),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id),
  taskId: uuid("task_id").references(() => tasks.id),
  tags: text("tags").array(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  pinned: boolean("pinned").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .references(() => tasks.id)
    .notNull(),
  humanAssignee: text("human_assignee").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceFiles = pgTable("workspace_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileTree: jsonb("file_tree").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Agent Budgets ────────────────────────────────────────────────────

export const agentBudgets = pgTable("agent_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  monthlyLimit: numeric("monthly_limit", { precision: 12, scale: 4 }).notNull(),
  currentSpend: numeric("current_spend", { precision: 12, scale: 4 }).notNull().default("0"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  alertThreshold: integer("alert_threshold").notNull().default(80),
  autoPause: boolean("auto_pause").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Cost Events ──────────────────────────────────────────────────────

export const costEvents = pgTable("cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Org Chart Nodes ─────────────────────────────────────────────────

export const orgChartNodes = pgTable("org_chart_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  agentId: text("agent_id").notNull(),
  parentNodeId: uuid("parent_node_id"),
  positionTitle: text("position_title").notNull(),
  canDelegate: boolean("can_delegate").notNull().default(true),
  sortIndex: integer("sort_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Approval Gates ──────────────────────────────────────────────────

export const approvalGates = pgTable("approval_gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  gateType: gateTypeEnum("gate_type").notNull(),
  requiresHuman: boolean("requires_human").notNull().default(true),
  approverAgentId: text("approver_agent_id"),
  approverUserId: uuid("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Approval Requests ───────────────────────────────────────────────

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  gateId: uuid("gate_id")
    .references(() => approvalGates.id, { onDelete: "cascade" })
    .notNull(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  requestedBy: text("requested_by").notNull(),
  requestType: text("request_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Config Versions ─────────────────────────────────────────────────

export const configVersions = pgTable("config_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  version: integer("version").notNull(),
  configSnapshot: jsonb("config_snapshot").$type<Record<string, unknown>>().notNull(),
  changedBy: text("changed_by").notNull(),
  changeDescription: text("change_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Audit Log (immutable, append-only) ──────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Heartbeat Schedules ────────────────────────────────────────────

export const heartbeatSchedules = pgTable("heartbeat_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  agentId: text("agent_id").notNull(),
  schedule: text("schedule").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  timezone: text("timezone").notNull().default("UTC"),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  nextExecutionAt: timestamp("next_execution_at", { withTimezone: true }),
  maxDurationMinutes: integer("max_duration_minutes").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Heartbeat Executions ───────────────────────────────────────────

export const heartbeatExecutions = pgTable("heartbeat_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id")
    .references(() => heartbeatSchedules.id, { onDelete: "cascade" })
    .notNull(),
  agentId: text("agent_id").notNull(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  status: heartbeatExecutionStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  tasksDiscovered: integer("tasks_discovered").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  actionsTaken: jsonb("actions_taken").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Escalation Paths ───────────────────────────────────────────────

export const escalationPaths = pgTable("escalation_paths", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  triggerType: escalationTriggerEnum("trigger_type").notNull(),
  sourceAgentId: text("source_agent_id"),
  escalateToAgentId: text("escalate_to_agent_id"),
  escalateToUserId: uuid("escalate_to_user_id").references(() => users.id, { onDelete: "set null" }),
  timeoutMinutes: integer("timeout_minutes").notNull().default(60),
  autoEscalate: boolean("auto_escalate").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Skills ─────────────────────────────────────────────────────────

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  source: text("source").notNull().default("custom"),
  sourceUrl: text("source_url"),
  sourceRef: text("source_ref"),
  version: text("version"),
  content: text("content"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  installed: boolean("installed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Agent Skills (many-to-many) ────────────────────────────────────

export const agentSkills = pgTable("agent_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .references(() => agents.id, { onDelete: "cascade" })
    .notNull(),
  skillId: uuid("skill_id")
    .references(() => skills.id, { onDelete: "cascade" })
    .notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Company Provider Keys ──────────────────────────────────────────

export const companyProviderKeys = pgTable("company_provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  provider: text("provider").notNull(), // "anthropic" | "openai" | "google" | "openrouter"
  apiKey: text("api_key").notNull(),
  label: text("label"), // optional human-friendly label
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Routine Templates ──────────────────────────────────────────────

// ─── Blueprint Types ───────────────────────────────────────────────

/** Template for a single agent within a blueprint */
export interface BlueprintAgentTemplate {
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  color: string;
  role: string;
  adapterType: string;
  model?: string;
  reportsTo?: string;
  promptTemplate?: string;
  skills?: string[];
}

/** Full blueprint template containing agents, hierarchy, and metadata */
export interface BlueprintTemplate {
  agents: BlueprintAgentTemplate[];
  hierarchy: { callsign: string; children: string[] }[];
  description: string;
  useCases: string[];
}

// ─── Team Blueprints ───────────────────────────────────────────────

export const teamBlueprints = pgTable("team_blueprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  icon: text("icon").notNull(),
  agentCount: integer("agent_count").notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  template: jsonb("template").$type<BlueprintTemplate>().notNull(),
  popularity: integer("popularity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Inbox Messages ────────────────────────────────────────────────

/** Action button rendered on an inbox message */
export interface InboxAction {
  id: string;
  label: string;
  style: "primary" | "danger" | "ghost";
  action: "approve" | "reject" | "reassign" | "snooze" | "dismiss" | "custom";
  payload?: Record<string, unknown>;
}

/** Context linking an inbox message to other entities */
export interface InboxMessageContext {
  taskId?: string;
  projectId?: string;
  relatedAgents?: string[];
  metadata?: Record<string, unknown>;
}

export const inboxMessages = pgTable("inbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  fromAgentId: text("from_agent_id").notNull(),
  toUserId: uuid("to_user_id"),
  toAgentId: text("to_agent_id"),
  type: text("type").notNull(), // decision | blocker | completed | question | escalation | update | approval
  priority: text("priority").notNull().default("normal"), // critical | high | normal | low
  title: text("title").notNull(),
  body: text("body").notNull(),
  context: jsonb("context").$type<InboxMessageContext>(),
  actions: jsonb("actions").$type<InboxAction[]>(),
  status: text("status").notNull().default("unread"), // unread | read | actioned | snoozed | dismissed
  actionedBy: text("actioned_by"),
  actionedAt: timestamp("actioned_at", { withTimezone: true }),
  actionResult: text("action_result"),
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Agent Access Grants ───────────────────────────────────────────

export const agentAccessGrants = pgTable("agent_access_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .references(() => agents.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  grantedBy: text("granted_by").notNull(),
  canInteract: boolean("can_interact").notNull().default(true),
  canConfigure: boolean("can_configure").notNull().default(false),
  canViewLogs: boolean("can_view_logs").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Routine Template Types ────────────────────────────────────────

interface TaskTemplate {
  titlePattern: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "critical";
  assigneeAgentId: string | null;
  projectId: string | null;
}

export const routineTemplates = pgTable("routine_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description"),
  taskTemplate: jsonb("task_template").$type<TaskTemplate>().notNull(),
  schedule: text("schedule").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastCreatedAt: timestamp("last_created_at", { withTimezone: true }),
  nextCreateAt: timestamp("next_create_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
