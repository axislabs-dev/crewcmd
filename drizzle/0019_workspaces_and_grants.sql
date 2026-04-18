CREATE TYPE "workspace_type" AS ENUM('personal', 'company');
CREATE TYPE "workspace_access_level" AS ENUM('viewer', 'operator', 'manager');

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "workspace_type" NOT NULL,
  "name" text NOT NULL,
  "owner_user_id" uuid,
  "company_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "workspaces_type_owner_user_id_unique" UNIQUE("type","owner_user_id"),
  CONSTRAINT "workspaces_type_company_id_unique" UNIQUE("type","company_id")
);

ALTER TABLE "projects" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "tasks" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "activity_log" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "docs" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "org_chart_nodes" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "inbox_messages" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "inbox_messages" ALTER COLUMN "company_id" DROP NOT NULL;

ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "docs" ADD CONSTRAINT "docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "agent_workspace_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "access_level" "workspace_access_level" DEFAULT 'operator' NOT NULL,
  "granted_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_workspace_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "agent_workspace_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "agent_workspace_grants_agent_id_workspace_id_unique" UNIQUE("agent_id","workspace_id")
);

INSERT INTO "workspaces" ("type", "name", "owner_user_id", "company_id")
SELECT 'company', c.name, NULL, c.id
FROM "companies" c
ON CONFLICT ("type", "company_id") DO NOTHING;

INSERT INTO "workspaces" ("type", "name", "owner_user_id", "company_id")
SELECT 'personal',
       COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'Personal Workspace'),
       u.id,
       NULL
FROM "users" u
ON CONFLICT ("type", "owner_user_id") DO NOTHING;

UPDATE "projects" p
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE p."workspace_id" IS NULL
  AND p."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = p."company_id";

UPDATE "tasks" t
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE t."workspace_id" IS NULL
  AND t."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = t."company_id";

UPDATE "activity_log" a
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE a."workspace_id" IS NULL
  AND a."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = a."company_id";

UPDATE "docs" d
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE d."workspace_id" IS NULL
  AND d."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = d."company_id";

UPDATE "org_chart_nodes" o
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE o."workspace_id" IS NULL
  AND o."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = o."company_id";

UPDATE "inbox_messages" i
SET "workspace_id" = w.id
FROM "workspaces" w
WHERE i."workspace_id" IS NULL
  AND i."company_id" IS NOT NULL
  AND w."type" = 'company'
  AND w."company_id" = i."company_id";

INSERT INTO "agent_workspace_grants" ("agent_id", "workspace_id", "access_level", "granted_by")
SELECT a.id,
       w.id,
       CASE WHEN a."owner_type" = 'company' THEN 'operator'::"workspace_access_level"
            ELSE 'manager'::"workspace_access_level"
       END,
       'migration'
FROM "agents" a
JOIN "workspaces" w
  ON (
    (a."owner_type" = 'company' AND w."type" = 'company' AND w."company_id" = COALESCE(a."owner_company_id", a."company_id"))
    OR
    (a."owner_type" = 'user' AND w."type" = 'personal' AND w."owner_user_id" = a."owner_user_id")
  )
ON CONFLICT ("agent_id", "workspace_id") DO NOTHING;
