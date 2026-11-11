-- 015: E06-08 — lembretes sob opt-in (políticas, agendamentos, opt-out)
CREATE TABLE IF NOT EXISTS reminder_policies (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  kind TEXT NOT NULL CHECK (kind IN ('TASK_DUE','FOLLOWUP')),
  offset_minutes INT NOT NULL DEFAULT 60,
  channel TEXT NOT NULL DEFAULT 'inapp' CHECK (channel IN ('inapp','email')),
  max_per_day INT NOT NULL DEFAULT 3 CHECK (max_per_day > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminder_policies_tenant_id') THEN
    ALTER TABLE reminder_policies ADD CONSTRAINT uq_reminder_policies_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  policy_id UUID NOT NULL,
  task_id UUID,
  lead_id UUID NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','SKIPPED','CANCELLED')),
  sent_at TIMESTAMPTZ,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_id, task_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminders_tenant_id') THEN
    ALTER TABLE reminders ADD CONSTRAINT uq_reminders_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminder_policies_fk') THEN
    ALTER TABLE reminders ADD CONSTRAINT uq_reminder_policies_fk
      FOREIGN KEY (tenant_id, policy_id) REFERENCES reminder_policies(tenant_id, id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_crm_tasks_tenant_id') THEN
    ALTER TABLE crm_tasks ADD CONSTRAINT uq_crm_tasks_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminders_task_fk') THEN
    ALTER TABLE reminders ADD CONSTRAINT uq_reminders_task_fk
      FOREIGN KEY (tenant_id, task_id) REFERENCES crm_tasks(tenant_id, id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminders_lead_fk') THEN
    ALTER TABLE reminders ADD CONSTRAINT uq_reminders_lead_fk
      FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(tenant_id, status, scheduled_for);

CREATE TABLE IF NOT EXISTS reminder_optouts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id UUID NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, lead_id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE
);
