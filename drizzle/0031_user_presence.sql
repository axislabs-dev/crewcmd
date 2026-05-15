CREATE TABLE IF NOT EXISTS "user_presence" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'active',
  "custom_text" text,
  "emoji" text,
  "manual_expires_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
