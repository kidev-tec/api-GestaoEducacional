-- E08-03: chamada e presença auditável — idempotente
CREATE TABLE IF NOT EXISTS session_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  enrollment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE','JUSTIFIED')),
  minutes_late INT NOT NULL DEFAULT 0 CHECK (minutes_late >= 0),
  justification TEXT,
  recorded_by UUID,
  revised_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id, enrollment_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES class_sessions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON session_attendance(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment ON session_attendance(tenant_id, enrollment_id);

-- FK composta de attendance_changes exige UNIQUE(tenant_id,id); idempotente também em DB onde a FK já existia sem ele
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_session_attendance_tenant_id') THEN
    BEGIN
      ALTER TABLE session_attendance ADD CONSTRAINT uq_session_attendance_tenant_id UNIQUE (tenant_id, id);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_changes_tenant_id_attendance_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_session_attendance_tenant_id') THEN
    ALTER TABLE attendance_changes DROP CONSTRAINT attendance_changes_tenant_id_attendance_id_fkey;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attendance_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  attendance_id UUID NOT NULL,
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, attendance_id) REFERENCES session_attendance(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attendance_changes ON attendance_changes(tenant_id, attendance_id, created_at DESC);
