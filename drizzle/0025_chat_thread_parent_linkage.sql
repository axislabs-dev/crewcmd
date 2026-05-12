ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "thread_parent_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "thread_parent_session_key" text;
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "thread_parent_message_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_thread_parent_session_id_chat_sessions_id_fk" FOREIGN KEY ("thread_parent_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
