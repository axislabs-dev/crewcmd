DO $$ BEGIN
 CREATE TYPE "channel_type" AS ENUM ('channel', 'dm', 'project_room', 'voice_room');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "channel_visibility" AS ENUM ('private', 'restricted', 'team', 'org');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "channel_post_policy" AS ENUM ('members', 'contributors', 'admins', 'read_only');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "channel_member_type" AS ENUM ('user', 'agent');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "channel_member_role" AS ENUM ('owner', 'admin', 'member', 'contributor', 'viewer', 'guest');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "agent_participation_mode" AS ENUM ('silent', 'watching', 'mention_only', 'proactive', 'on_call');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "workspace_id" uuid,
  "type" "channel_type" DEFAULT 'channel' NOT NULL,
  "name" text,
  "slug" text,
  "description" text,
  "scope_type" text DEFAULT 'channel' NOT NULL,
  "scope_id" uuid,
  "visibility" "channel_visibility" DEFAULT 'restricted' NOT NULL,
  "default_post_policy" "channel_post_policy" DEFAULT 'members' NOT NULL,
  "default_agent_mode" "agent_participation_mode" DEFAULT 'mention_only' NOT NULL,
  "created_by_user_id" uuid,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "channel_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL,
  "member_type" "channel_member_type" NOT NULL,
  "user_id" uuid,
  "agent_id" uuid,
  "role" "channel_member_role" DEFAULT 'member' NOT NULL,
  "agent_participation_mode" "agent_participation_mode",
  "can_post_override" boolean,
  "can_invite_override" boolean,
  "joined_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_joined_by_user_id_users_id_fk" FOREIGN KEY ("joined_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_exactly_one_principal_check" CHECK (
   ("member_type" = 'user' AND "user_id" IS NOT NULL AND "agent_id" IS NULL AND "agent_participation_mode" IS NULL)
   OR
   ("member_type" = 'agent' AND "agent_id" IS NOT NULL AND "user_id" IS NULL)
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "channels_company_slug_unique" ON "channels" ("company_id", "slug") WHERE "company_id" IS NOT NULL AND "slug" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "channels_workspace_slug_unique" ON "channels" ("workspace_id", "slug") WHERE "workspace_id" IS NOT NULL AND "slug" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "channels_company_idx" ON "channels" ("company_id");
CREATE INDEX IF NOT EXISTS "channels_workspace_idx" ON "channels" ("workspace_id");
CREATE INDEX IF NOT EXISTS "channels_scope_idx" ON "channels" ("scope_type", "scope_id");

CREATE UNIQUE INDEX IF NOT EXISTS "channel_members_channel_user_unique" ON "channel_members" ("channel_id", "user_id") WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "channel_members_channel_agent_unique" ON "channel_members" ("channel_id", "agent_id") WHERE "agent_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "channel_members_channel_idx" ON "channel_members" ("channel_id");
CREATE INDEX IF NOT EXISTS "channel_members_user_idx" ON "channel_members" ("user_id");
CREATE INDEX IF NOT EXISTS "channel_members_agent_idx" ON "channel_members" ("agent_id");
CREATE INDEX IF NOT EXISTS "channel_members_role_idx" ON "channel_members" ("channel_id", "role");

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "channel_id" uuid;
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "chat_sessions_channel_idx" ON "chat_sessions" ("channel_id");

ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "channel_id" uuid;
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "chat_threads_channel_idx" ON "chat_threads" ("channel_id");
