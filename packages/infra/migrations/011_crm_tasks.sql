-- 011_crm_tasks.sql — E06-C: tarefas follow-up + round-robin + SLA (SPEC-E06-C-tasks-v1 FROZEN)
-- FK composta padrão do repo: leads precisa UNIQUE(tenant_id, id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_leads_tenant_id') THEN
    ALTER TABLE leads ADD CONSTRAINT uq_leads_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id UUID NOT NULL,
  assigned_to UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('call','visit','email','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','canceled')),
  due_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ,
  cancel_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON crm_tasks(tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON crm_tasks(lead_id, created_at);

CREATE TABLE IF NOT EXISTS crm_rotation (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  position BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);

-- config SLA por tenant (key/value genérico)
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
