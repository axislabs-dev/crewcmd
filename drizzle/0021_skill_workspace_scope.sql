ALTER TABLE "skills"
  ALTER COLUMN "company_id" DROP NOT NULL;

ALTER TABLE "skills"
  ADD COLUMN "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE cascade;
