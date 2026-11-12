-- E12-02: importador CSV com prévia/dry-run (idempotente)
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity TEXT NOT NULL CHECK (entity IN ('people')),
  status TEXT NOT NULL DEFAULT 'DRY_RUN' CHECK (status IN ('DRY_RUN','COMMITTED','FAILED')),
  mapping JSONB NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  valid_rows INT NOT NULL DEFAULT 0,
  skipped_rows INT NOT NULL DEFAULT 0,
  error_rows INT NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id, created_at DESC);
