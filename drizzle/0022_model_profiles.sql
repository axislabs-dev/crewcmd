CREATE TABLE IF NOT EXISTS "model_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" "ownership_type" NOT NULL,
  "owner_user_id" uuid,
  "owner_company_id" uuid,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "profile_key" text,
  "provider_preferences" jsonb DEFAULT '[]'::jsonb,
  "primary_model" text,
  "fallback_models" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "model_profiles_owner_scope_check" CHECK (
    ("owner_type" = 'user' AND "owner_user_id" IS NOT NULL AND "owner_company_id" IS NULL)
    OR ("owner_type" = 'company' AND "owner_company_id" IS NOT NULL AND "owner_user_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_model_defaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "model_profile_id" uuid,
  "model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_model_defaults_choice_check" CHECK (
    ("model_profile_id" IS NOT NULL AND "model" IS NULL)
    OR ("model_profile_id" IS NULL AND "model" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_owner_company_id_companies_id_fk" FOREIGN KEY ("owner_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_model_defaults" ADD CONSTRAINT "company_model_defaults_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_model_defaults" ADD CONSTRAINT "company_model_defaults_model_profile_id_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_profiles_user_slug_idx" ON "model_profiles" ("owner_type", "owner_user_id", "slug") WHERE "owner_type" = 'user';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_profiles_company_slug_idx" ON "model_profiles" ("owner_type", "owner_company_id", "slug") WHERE "owner_type" = 'company';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_model_defaults_company_idx" ON "company_model_defaults" ("company_id");
