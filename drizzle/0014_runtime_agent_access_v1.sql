DO $$ BEGIN
  CREATE TYPE ownership_type AS ENUM ('user', 'company');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_visibility AS ENUM ('private', 'team', 'org');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE company_runtimes
  ADD COLUMN IF NOT EXISTS owner_type ownership_type NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS owner_company_id uuid;

UPDATE company_runtimes
SET owner_company_id = company_id
WHERE owner_company_id IS NULL;

ALTER TABLE company_runtimes
  ADD CONSTRAINT company_runtimes_owner_user_id_users_id_fk
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE company_runtimes
  ADD CONSTRAINT company_runtimes_owner_company_id_companies_id_fk
  FOREIGN KEY (owner_company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS owner_type ownership_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS owner_company_id uuid,
  ADD COLUMN IF NOT EXISTS visibility agent_visibility NOT NULL DEFAULT 'private';

ALTER TABLE agents
  ADD CONSTRAINT agents_owner_user_id_users_id_fk
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE agents
  ADD CONSTRAINT agents_owner_company_id_companies_id_fk
  FOREIGN KEY (owner_company_id) REFERENCES companies(id) ON DELETE SET NULL;

UPDATE agents
SET owner_company_id = company_id,
    owner_type = 'company',
    visibility = CASE WHEN visibility = 'team' THEN 'team' ELSE 'private' END::agent_visibility
WHERE company_id IS NOT NULL;

UPDATE agents
SET visibility = 'private'::agent_visibility
WHERE visibility IS NULL;
