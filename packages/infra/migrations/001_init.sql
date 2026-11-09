-- expand: cria estruturas novas sem quebrar as antigas (idempotente)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  student_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT','PENDING_DOCUMENTS','PENDING_APPROVAL','ACTIVE','COMPLETED','CANCELED','REJECTED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('CHARGE','PAYMENT','REVERSAL')),
  amount_cents BIGINT NOT NULL,
  reverses TEXT REFERENCES ledger_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotência de ledger ESCOPADA POR TENANT no banco (defesa final)
CREATE TABLE IF NOT EXISTS ledger_idempotency (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

-- enrollments idempotentes por tenant+key
CREATE TABLE IF NOT EXISTS enrollment_idempotency (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

-- audit append-only no banco: sem UPDATE/DELETE por design de permissão
CREATE TABLE IF NOT EXISTS audit_records (
  seq BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant ON enrollments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_records(tenant_id);
