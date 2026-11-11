-- 013: E06-06 — comissões versionadas + metas comerciais
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  version INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PERCENT','FLAT')),
  value NUMERIC(12,4) NOT NULL CHECK (
    (kind = 'PERCENT' AND value > 0 AND value <= 50) OR (kind = 'FLAT' AND value > 0)
  ),
  target_user_id TEXT,
  min_total_cents INT,
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_commission_rules_tenant_id') THEN
    ALTER TABLE commission_rules ADD CONSTRAINT uq_commission_rules_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_commission_rules_tenant_active ON commission_rules(tenant_id, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS commission_credits (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  rule_id UUID NOT NULL,
  rule_version INT NOT NULL,
  enrollment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  base_cents INT NOT NULL CHECK (base_cents > 0),
  amount_cents INT NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REVERSED','CANCELED')),
  source_event TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, enrollment_id, rule_version, user_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_commission_credits_tenant_id') THEN
    ALTER TABLE commission_credits ADD CONSTRAINT uq_commission_credits_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_commission_rules_tv') THEN
    ALTER TABLE commission_credits ADD CONSTRAINT uq_commission_rules_tv
      FOREIGN KEY (tenant_id, rule_id) REFERENCES commission_rules(tenant_id, id) ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_enrollments_tenant_id') THEN
    ALTER TABLE enrollments ADD CONSTRAINT uq_enrollments_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_commission_credits_enr') THEN
    ALTER TABLE commission_credits ADD CONSTRAINT uq_commission_credits_enr
      FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_commission_credits_tenant_user ON commission_credits(tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS sales_targets (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, period)
);
