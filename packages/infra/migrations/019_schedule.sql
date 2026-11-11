-- E08-02: grade, horários, salas, feriados e sessões (idempotente)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  unit_id UUID NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, unit_id, name),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date)
);

CREATE TABLE IF NOT EXISTS class_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  class_id UUID NOT NULL,
  room_id UUID,
  weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INT NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute INT NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, class_id, weekday, start_minute),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id) ON DELETE SET NULL,
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant_class ON class_schedules(tenant_id, class_id);

CREATE TABLE IF NOT EXISTS class_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  class_id UUID NOT NULL,
  schedule_id UUID,
  room_id UUID,
  date DATE NOT NULL,
  start_minute INT NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute INT NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','RESCHEDULED','CANCELED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, class_id, date, start_minute),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, schedule_id) REFERENCES class_schedules(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id) ON DELETE SET NULL,
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_date ON class_sessions(tenant_id, date);

CREATE TABLE IF NOT EXISTS session_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  session_id UUID NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('CREATE','RESCHEDULE','CANCEL')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, session_id) REFERENCES class_sessions(tenant_id, id) ON DELETE CASCADE
);
