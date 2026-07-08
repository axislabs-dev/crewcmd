CREATE TABLE IF NOT EXISTS "realtime_events" (
  "sequence" bigserial PRIMARY KEY,
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "type" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE cascade,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE cascade,
  "channel_id" uuid REFERENCES "channels"("id") ON DELETE set null,
  "session_id" uuid REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "session_key" text,
  "thread_parent_session_key" text,
  "thread_session_key" text,
  "actor_type" text,
  "actor_id" text,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "realtime_events_company_sequence_idx"
  ON "realtime_events" ("company_id", "sequence");

CREATE INDEX IF NOT EXISTS "realtime_events_workspace_sequence_idx"
  ON "realtime_events" ("workspace_id", "sequence");

CREATE INDEX IF NOT EXISTS "realtime_events_channel_sequence_idx"
  ON "realtime_events" ("channel_id", "sequence");

CREATE INDEX IF NOT EXISTS "realtime_events_session_sequence_idx"
  ON "realtime_events" ("session_id", "sequence");

CREATE INDEX IF NOT EXISTS "realtime_events_created_at_idx"
  ON "realtime_events" ("created_at");
