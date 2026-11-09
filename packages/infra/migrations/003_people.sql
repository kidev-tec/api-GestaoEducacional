-- E05-A: pessoas, responsáveis e unidades (idempotente)
-- Integridade cross-tenant no BANCO: FKs compostas incluem tenant_id, então
-- pessoa nunca aponta para unidade de outro tenant, nem guardianship entre tenants.
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  parent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES units(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  unit_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('STUDENT','GUARDIAN','STAFF')),
  name TEXT NOT NULL,
  document TEXT,
  email CITEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS guardianships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  guardian_id UUID NOT NULL,
  student_id UUID NOT NULL,
  relation TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_id),
  CHECK (guardian_id <> student_id),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES people(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_id) REFERENCES people(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_units_tenant ON units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_people_tenant_unit ON people(tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_people_tenant_kind ON people(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_guardianships_tenant_student ON guardianships(tenant_id, student_id, is_primary DESC);
