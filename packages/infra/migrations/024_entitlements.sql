-- E13-02: entitlements por tenant (licença de módulos do catálogo) — idempotente
CREATE TABLE IF NOT EXISTS tenant_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  module_key TEXT NOT NULL REFERENCES module_catalog(key),
  seats INT CHECK (seats IS NULL OR seats >= 1),
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at DATE,
  ends_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_tenant ON tenant_entitlements(tenant_id, active);

CREATE TABLE IF NOT EXISTS entitlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  module_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('GRANTED','REVOKED','SEATS_CHANGED','ACTIVATED','DEACTIVATED')),
  seats INT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entitlement_events ON entitlement_events(tenant_id, module_key, created_at DESC);
