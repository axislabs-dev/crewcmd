ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "thread_parent_message_fingerprint" text;
