CREATE TABLE "company_runtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"runtime_type" text DEFAULT 'openclaw' NOT NULL,
	"name" text NOT NULL,
	"gateway_url" text NOT NULL,
	"http_url" text NOT NULL,
	"auth_token" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_ping" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "canvas_position" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_ref" text;--> statement-breakpoint
ALTER TABLE "company_runtimes" ADD CONSTRAINT "company_runtimes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_runtime_id_company_runtimes_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."company_runtimes"("id") ON DELETE set null ON UPDATE no action;