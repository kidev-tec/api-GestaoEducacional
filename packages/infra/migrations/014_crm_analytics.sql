-- 014: E06-07 — atribuição de origem + snapshots de funil (auditoria)
CREATE TABLE IF NOT EXISTS lead_source_attribution (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id UUID NOT NULL,
  campaign TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  first_touch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_lead_source_attr_tenant_id') THEN
    ALTER TABLE lead_source_attribution ADD CONSTRAINT uq_lead_source_attr_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_attr_lead ON lead_source_attribution(tenant_id, lead_id);

CREATE TABLE IF NOT EXISTS funnel_snapshots (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unit_id UUID,
  payload JSONB NOT NULL,
  UNIQUE (tenant_id, computed_at, unit_id)
);
