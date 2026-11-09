-- E07-A: planos de mensalidade, tuitions (títulos) e alocações de pagamento (idempotente)
-- Integridade cross-tenant no BANCO: FKs compostas incluem tenant_id (padrão E05-A r1).
CREATE TABLE IF NOT EXISTS tuition_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 12),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS tuitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id UUID NOT NULL,
  student_id UUID NOT NULL,
  reference TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED','CANCELED')),
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, reference),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES tuition_plans(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_id) REFERENCES people(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tuition_id UUID NOT NULL,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_entry_id),
  FOREIGN KEY (tenant_id, tuition_id) REFERENCES tuitions(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tuitions_tenant_status ON tuitions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tuitions_tenant_student ON tuitions(tenant_id, student_id, reference);
CREATE INDEX IF NOT EXISTS idx_allocations_tuition ON payment_allocations(tuition_id);
