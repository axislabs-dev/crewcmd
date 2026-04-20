ALTER TABLE "skills" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "skills" ALTER COLUMN "company_id" DROP NOT NULL;

UPDATE "skills" s
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE s."workspace_id" IS NULL
  AND s."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = s."company_id";
