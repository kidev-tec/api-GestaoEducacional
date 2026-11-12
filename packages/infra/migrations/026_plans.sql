-- E13-03: planos versionados, limites transparentes e assinaturas — idempotente
-- Coexiste com 006_plans.sql (E13-A): sem tocar em plans/plan_modules/plan_limits/tenant_plans.
CREATE TABLE IF NOT EXISTS plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  version INT NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('STANDARD','PILOT','FRANCHISE')),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('MONTHLY','ANNUAL')),
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0),
  seat_price_cents INT CHECK (seat_price_cents IS NULL OR seat_price_cents >= 0),
  min_units INT NOT NULL DEFAULT 1 CHECK (min_units >= 1),
  max_units INT CHECK (max_units IS NULL OR max_units >= 1),
  trial_days INT NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  published BOOLEAN NOT NULL DEFAULT false,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
CREATE INDEX IF NOT EXISTS idx_plan_versions_key ON plan_versions(key, published, effective_from DESC);

CREATE TABLE IF NOT EXISTS plan_version_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id UUID NOT NULL REFERENCES plan_versions(id),
  limit_key TEXT NOT NULL,
  limit_value INT CHECK (limit_value IS NULL OR limit_value >= 0),
  UNIQUE (plan_version_id, limit_key)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_version_id UUID NOT NULL REFERENCES plan_versions(id),
  status TEXT NOT NULL CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','CANCELED')),
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  current_period_end DATE,
  price_override_cents INT CHECK (price_override_cents IS NULL OR price_override_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
