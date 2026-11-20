-- E06-CONTRACT: contrato escolar gera títulos a partir da matrícula (jornada 3 SPEC-E00)
CREATE TABLE IF NOT EXISTS school_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  enrollment_id TEXT NOT NULL,
  plan_id UUID NOT NULL,
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents > 0),
  installments INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 12),
  start_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','CANCELED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES tuition_plans(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_contracts_enrollment_active
  ON school_contracts(tenant_id, enrollment_id) WHERE status IN ('DRAFT','ACTIVE');

CREATE INDEX IF NOT EXISTS idx_school_contracts_tenant ON school_contracts(tenant_id, status);

-- idempotência de criação escopada por tenant (padrão enrollments)
CREATE TABLE IF NOT EXISTS school_contract_idempotency (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  contract_id UUID NOT NULL,
  enrollment_id TEXT NOT NULL,
  plan_id UUID NOT NULL,
  monthly_price_cents INTEGER NOT NULL,
  installments INTEGER NOT NULL,
  start_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES school_contracts(tenant_id, id) ON DELETE RESTRICT
);
