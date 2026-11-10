-- E13-A: catálogo de planos + entitlements persistidos + grandfathering
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_modules (
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  PRIMARY KEY (plan_id, module)
);

CREATE TABLE IF NOT EXISTS plan_limits (
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  limit_key TEXT NOT NULL,
  limit_value INT NOT NULL, -- -1 = ilimitado; 0 = bloqueado
  PRIMARY KEY (plan_id, limit_key)
);

CREATE TABLE IF NOT EXISTS tenant_plans (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_plans_current ON tenant_plans(tenant_id) WHERE ended_at IS NULL;
