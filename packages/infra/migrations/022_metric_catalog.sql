-- E11-01: catálogo de métricas com fórmulas SQL parametrizadas + snapshots append-only (idempotente)
CREATE TABLE IF NOT EXISTS metric_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  formula_sql TEXT NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAY','WEEK','MONTH','QUARTER')),
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  owner UUID,
  source_tables TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  metric_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  value NUMERIC(18,4) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_key, period_start),
  FOREIGN KEY (metric_key) REFERENCES metric_catalog(key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_metric_snap_tenant ON metric_snapshots(tenant_id, metric_key, period_start);

-- Seed idempotente: 8 métricas core (formula usa $1=tenant, $2=from, $3=to)
INSERT INTO metric_catalog (key, name, description, formula_sql, granularity, source_tables) VALUES
  ('revenue_month', 'Receita do período', 'Total de CHARGE - REVERSAL no período',
   $f$SELECT COALESCE(SUM(amount_cents),0)::numeric FROM ledger_entries WHERE tenant_id = $1 AND type IN ('CHARGE','REVERSAL') AND created_at >= $2 AND created_at < $3$f$,
   'MONTH', '{ledger_entries}'),
  ('lead_conversion_rate', 'Conversão de leads', 'Leads WON / total de leads criados no período',
   $f$SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.id = leads.stage_id AND ps.kind = 'won')))::numeric / COUNT(*) END FROM leads WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3$f$,
   'WEEK', '{leads}'),
  ('pipeline_value', 'Valor do pipeline', 'Soma do estimated_value_cents de leads abertos',
   $f$SELECT COALESCE(SUM(estimated_value_cents),0)::numeric FROM leads WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.id = leads.stage_id AND ps.kind IN ('won','lost'))$f$,
   'DAY', '{leads}'),
  ('active_enrollments', 'Matrículas ativas', 'Matrículas em estado ACTIVE',
   $f$SELECT COUNT(*)::numeric FROM enrollments WHERE tenant_id = $1 AND state = 'ACTIVE' AND created_at < $3$f$,
   'DAY', '{enrollments}'),
  ('classes_open', 'Turmas abertas', 'Turmas em estado OPEN ou RUNNING',
   $f$SELECT COUNT(*)::numeric FROM classes WHERE tenant_id = $1 AND status IN ('OPEN','RUNNING')$f$,
   'DAY', '{classes}'),
  ('sessions_week', 'Sessões da semana', 'Sessões agendadas no período',
   $f$SELECT COUNT(*)::numeric FROM class_sessions WHERE tenant_id = $1 AND date >= $2 AND date <= $3 AND status <> 'CANCELED'$f$,
   'WEEK', '{class_sessions}'),
  ('overdue_tasks', 'Tarefas vencidas', 'Tarefas abertas com vencimento no passado',
   $f$SELECT COUNT(*)::numeric FROM crm_tasks WHERE tenant_id = $1 AND status = 'open' AND due_at < now()$f$,
   'DAY', '{crm_tasks}')
ON CONFLICT (key) DO NOTHING;
