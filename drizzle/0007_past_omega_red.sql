CREATE TYPE "public"."doc_type" AS ENUM('sop', 'guide', 'reference', 'runbook', 'general');--> statement-breakpoint
CREATE TYPE "public"."doc_visibility" AS ENUM('company', 'project', 'agents_only');--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "doc_type" "doc_type" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "visibility" "doc_visibility" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "author_user_id" uuid;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;