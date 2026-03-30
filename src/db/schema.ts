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
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "viewer",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubUsername: text("github_username").notNull().unique(),
  githubId: text("github_id"),
  email: text("email"),
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

export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  authorAgentId: text("author_agent_id"),
  projectId: uuid("project_id").references(() => projects.id),
  taskId: uuid("task_id").references(() => tasks.id),
  tags: text("tags").array(),
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
