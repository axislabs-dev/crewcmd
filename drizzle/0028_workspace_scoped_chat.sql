ALTER TABLE "chat_sessions" ALTER COLUMN "company_id" DROP NOT NULL;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;

DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "chat_threads" ALTER COLUMN "company_id" DROP NOT NULL;
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;

DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_workspace_id_thread_session_key_unique" UNIQUE("workspace_id","thread_session_key");
