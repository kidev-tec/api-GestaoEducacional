-- E09-02: templates versionados com revisão e proteção de PII (idempotente)
CREATE TABLE IF NOT EXISTS comm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('inapp','email')),
  locale TEXT NOT NULL CHECK (locale IN ('pt','en','es')),
  version INT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sample_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_key, channel, locale, version)
);
CREATE INDEX IF NOT EXISTS idx_comm_templates_tenant ON comm_templates(tenant_id, event_key, channel, locale);
