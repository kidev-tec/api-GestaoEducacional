-- E05-A: pessoas, responsáveis e unidades (idempotente)
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES units(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  kind TEXT NOT NULL CHECK (kind IN ('STUDENT','GUARDIAN','STAFF')),
  name TEXT NOT NULL,
  document TEXT,
  email CITEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardianships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  guardian_id UUID NOT NULL REFERENCES people(id),
  student_id UUID NOT NULL REFERENCES people(id),
  relation TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_id),
  CHECK (guardian_id <> student_id)
);

CREATE INDEX IF NOT EXISTS idx_units_tenant ON units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_people_tenant ON people(tenant_id);
CREATE INDEX IF NOT EXISTS idx_people_unit ON people(unit_id);
CREATE INDEX IF NOT EXISTS idx_guardianships_student ON guardianships(student_id);
