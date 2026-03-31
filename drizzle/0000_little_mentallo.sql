-- Baseline migration: all initial tables and enums
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('online', 'idle', 'working', 'offline');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('manual', 'error_log', 'test_failure', 'ui_scan', 'ci_failure', 'agent_initiative');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'inbox', 'queued', 'assigned', 'in_progress', 'review', 'done', 'failed', 'todo', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pr_status" AS ENUM('open', 'changes_requested', 'approved', 'merged', 'closed_duplicate', 'closed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_username" text,
	"github_id" text,
	"email" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" text,
	"invite_token" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_username_unique" UNIQUE("github_username"),
	CONSTRAINT "users_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callsign" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"emoji" text NOT NULL,
	"color" text NOT NULL,
	"status" "agent_status" DEFAULT 'offline' NOT NULL,
	"current_task" text,
	"last_active" timestamp DEFAULT now(),
	"reports_to" text,
	"soul_content" text,
	CONSTRAINT "agents_callsign_unique" UNIQUE("callsign")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#00f0ff' NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"owner_agent_id" text,
	"documents" jsonb,
	"context" text,
	"context_updated_at" timestamp with time zone,
	"context_updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_id" serial NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'inbox' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"assigned_agent_id" text,
	"human_assignee" text,
	"project_id" uuid,
	"pr_url" text,
	"pr_status" "pr_status",
	"branch" text,
	"repo" text,
	"review_notes" text,
	"review_cycle_count" integer DEFAULT 0 NOT NULL,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"source" "task_source" DEFAULT 'manual' NOT NULL,
	"error_hash" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_short_id_unique" UNIQUE("short_id"),
	CONSTRAINT "tasks_error_hash_unique" UNIQUE("error_hash")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text,
	"action_type" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_heartbeats" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"callsign" text NOT NULL,
	"status" text NOT NULL,
	"current_task" text,
	"last_active" timestamp with time zone NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"raw_data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"schedule" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run" timestamp with time zone,
	"next_run" timestamp with time zone,
	"target" text,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_status" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"platform" text,
	"version" text,
	"remote_ip" text,
	"connected_at" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text NOT NULL,
	"author_agent_id" text,
	"project_id" uuid,
	"task_id" uuid,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"human_assignee" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"duration_seconds" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_tree" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
