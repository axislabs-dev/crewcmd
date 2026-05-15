CREATE TABLE IF NOT EXISTS "tray_pins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE cascade,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "target_key" text NOT NULL,
  "title" text NOT NULL,
  "metadata" jsonb,
  "sort_index" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("user_id", "target_type", "target_key")
);

CREATE INDEX IF NOT EXISTS "tray_pins_user_scope_idx"
  ON "tray_pins" ("user_id", "workspace_id", "company_id");
