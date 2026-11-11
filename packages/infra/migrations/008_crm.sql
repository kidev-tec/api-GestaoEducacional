-- 008_crm.sql
-- E06-A: leads + funil v1 (SPEC-E06-A-crm-v1 FROZEN)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email citext NOT NULL,
  phone TEXT,
  source TEXT NOT NULL CHECK (source IN ('website','referral','social','event','other')),
  campaign TEXT,
  consent BOOLEAN NOT NULL DEFAULT false,
  stage TEXT NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','CONTACTED','QUALIFIED','WON','LOST')),
  lost_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_email ON leads(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_stage ON leads(tenant_id, stage);
