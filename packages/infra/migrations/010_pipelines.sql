-- 010_pipelines.sql — E06-B: funil configurável + histórico (SPEC-E06-B-funnel-v1 FROZEN)
CREATE TABLE IF NOT EXISTS lead_pipelines (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),
  name TEXT NOT NULL DEFAULT 'Funil padrão',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES lead_pipelines(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open','won','lost')),
  position INTEGER NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, position)
);
CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON pipeline_stages(pipeline_id, position) WHERE NOT archived;

CREATE TABLE IF NOT EXISTS lead_stage_history (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id),
  to_stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_lead ON lead_stage_history(lead_id, changed_at);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES pipeline_stages(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_value_cents BIGINT NOT NULL DEFAULT 0 CHECK (estimated_value_cents >= 0);

-- bootstrap: pipeline default + estágios default por tenant existente + migração stage textual
DO $$
DECLARE t RECORD; p UUID; s_new UUID; s_won UUID; s_lost UUID;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    INSERT INTO lead_pipelines (id, tenant_id) VALUES (gen_random_uuid(), t.id) RETURNING id INTO p;
    INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
      VALUES (gen_random_uuid(), p, t.id, 'Novo', 'open', 1) RETURNING id INTO s_new;
    INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
      VALUES (gen_random_uuid(), p, t.id, 'Em contato', 'open', 2);
    INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
      VALUES (gen_random_uuid(), p, t.id, 'Qualificado', 'open', 3);
    INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
      VALUES (gen_random_uuid(), p, t.id, 'Ganho', 'won', 4) RETURNING id INTO s_won;
    INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
      VALUES (gen_random_uuid(), p, t.id, 'Perdido', 'lost', 5) RETURNING id INTO s_lost;
    UPDATE leads SET stage_id = CASE stage WHEN 'WON' THEN s_won WHEN 'LOST' THEN s_lost ELSE s_new END
      WHERE tenant_id = t.id AND stage_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE leads ALTER COLUMN stage_id SET NOT NULL;
