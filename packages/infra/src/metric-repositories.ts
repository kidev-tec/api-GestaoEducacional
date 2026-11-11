/**
 * E11-01 — catálogo de métricas com fórmulas SQL parametrizadas e snapshots append-only.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class MetricRuleError extends Error {}
export class MetricConflictError extends Error { override name = 'MetricConflictError'; }
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapMetricError(e: unknown): { status: number } {
  if (e instanceof MetricRuleError) return { status: 422 };
  if (e instanceof MetricConflictError) return { status: 409 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const GRANULARITIES = ['DAY', 'WEEK', 'MONTH', 'QUARTER'] as const;
// R1: whitelist de tabelas que fórmulas podem referenciar
const ALLOWED_TABLES = new Set(['ledger_entries', 'leads', 'enrollments', 'classes', 'class_sessions', 'crm_tasks']);

export type Metric = {
  key: string; name: string; description: string; formulaSql: string;
  granularity: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER'; timezone: string;
  owner: string | null; sourceTables: string[]; active: boolean;
};
type MRow = Record<string, unknown> & {
  key: string; name: string; description: string; formula_sql: string;
  granularity: Metric['granularity']; timezone: string; owner: string | null;
  source_tables: string[]; active: boolean;
};
const toMetric = (r: MRow): Metric => ({
  key: r.key, name: r.name, description: r.description, formulaSql: r.formula_sql,
  granularity: r.granularity, timezone: r.timezone, owner: r.owner, sourceTables: r.source_tables, active: r.active,
});

const validateFormula = (formulaSql: string, sourceTables: string[]): void => {
  if (!formulaSql.trim().toUpperCase().startsWith('SELECT')) throw new MetricRuleError('fórmula deve começar com SELECT');
  for (const t of sourceTables) {
    if (!ALLOWED_TABLES.has(t)) throw new MetricRuleError(`tabela fora da whitelist: ${t}`);
  }
  // contrato: placeholders são $1 (tenant), $2 (from), $3 (to) — nada além
  for (const m of formulaSql.matchAll(/\$(\d+)/g)) {
    if (Number(m[1]) > 3) throw new MetricRuleError(`placeholder $${m[1]} fora do contrato ($1 tenant, $2 from, $3 to)`);
  }
};

export async function createMetric(c: Pg, input: {
  key: string; name: string; description: string; granularity: Metric['granularity'];
  formulaSql: string; sourceTables: string[]; timezone?: string;
}): Promise<Metric> {
  if (!KEY_RE.test(input.key)) throw new MetricRuleError('key deve ser slug (a-z0-9_)');
  if (!GRANULARITIES.includes(input.granularity)) throw new MetricRuleError('granularidade inválida');
  validateFormula(input.formulaSql, input.sourceTables);
  const dup = await c.query('SELECT key FROM metric_catalog WHERE key = $1', [input.key]);
  if (dup.rowCount) throw new MetricConflictError('métrica já existe');
  const r = await c.query(
    `INSERT INTO metric_catalog (id, key, name, description, formula_sql, granularity, timezone, source_tables)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING key, name, description, formula_sql, granularity, timezone, owner, source_tables, active`,
    [randomUUID(), input.key, input.name, input.description, input.formulaSql, input.granularity, input.timezone ?? 'America/Sao_Paulo', input.sourceTables],
  );
  return toMetric(r.rows[0] as MRow);
}

export async function listMetrics(c: Pg): Promise<Metric[]> {
  const r = await c.query('SELECT key, name, description, formula_sql, granularity, timezone, owner, source_tables, active FROM metric_catalog ORDER BY created_at');
  return (r.rows as MRow[]).map(toMetric);
}

export async function getMetric(c: Pg, key: string): Promise<Metric> {
  const r = await c.query('SELECT key, name, description, formula_sql, granularity, timezone, owner, source_tables, active FROM metric_catalog WHERE key = $1', [key]);
  if (!r.rowCount) throw new NotFoundError('métrica não encontrada');
  return toMetric(r.rows[0] as MRow);
}

export async function updateMetric(c: Pg, key: string, patch: {
  name?: string; description?: string; owner?: string | null; active?: boolean;
}): Promise<Metric> {
  const cur = await c.query('SELECT key FROM metric_catalog WHERE key = $1', [key]);
  if (!cur.rowCount) throw new NotFoundError('métrica não encontrada');
  const r = await c.query(
    `UPDATE metric_catalog SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       owner = COALESCE($4, owner),
       active = COALESCE($5, active)
     WHERE key = $1
     RETURNING key, name, description, formula_sql, granularity, timezone, owner, source_tables, active`,
    [key, patch.name ?? null, patch.description ?? null, patch.owner ?? null, patch.active ?? null],
  );
  return toMetric(r.rows[0] as MRow);
}

/** Divide [from, to] em períodos pela granularidade (chunks de calendário simplificados). */
function periodsOf(granularity: Metric['granularity'], from: string, to: string): Array<{ start: string; end: string }> {
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new MetricRuleError('range de datas inválido');
  }
  const dayMs = 86_400_000;
  const chunkDays = granularity === 'DAY' ? 1
    : granularity === 'WEEK' ? 7
    : granularity === 'MONTH' ? 30
    : 90;
  const out: Array<{ start: string; end: string }> = [];
  let cur = startMs;
  while (cur <= endMs) {
    const next = Math.min(cur + chunkDays * dayMs, endMs + dayMs);
    out.push({ start: new Date(cur).toISOString().slice(0, 10), end: new Date(next).toISOString().slice(0, 10) });
    cur = next;
  }
  return out;
}

/** R2: calcula a fórmula por período e grava snapshots (append-only; duplicado → 409). */
export async function computeMetric(c: PoolClient, tenantId: string, key: string, from: string, to: string): Promise<{ saved: number; values: Array<{ periodStart: string; value: string }> }> {
  const met = await getMetric(c, key);
  if (!met.active) throw new MetricRuleError('métrica inativa');
  const periods = periodsOf(met.granularity, from, to);
  const values: Array<{ periodStart: string; value: string }> = [];
  for (const p of periods) {
    const dup = await c.query(
      'SELECT id FROM metric_snapshots WHERE tenant_id = $1 AND metric_key = $2 AND period_start = $3',
      [tenantId, key, p.start],
    );
    if (dup.rowCount) throw new MetricConflictError(`snapshot do período ${p.start} já calculada — use recompute explícito`);
    // executa passando apenas os placeholders que a fórmula referencia (pg falha com params não usados)
    const uses = (n: number): boolean => met.formulaSql.includes(`$${n}`);
    const vals: unknown[] = [];
    if (uses(1)) vals.push(tenantId);
    if (uses(2)) vals.push(p.start);
    if (uses(3)) vals.push(p.end);
    // remapear placeholders para sequencial ($1..$n) — seeds já usam $1,$2,$3 em ordem;
    // fórmulas que pulam um número precisam remapeio:
    let sql = met.formulaSql;
    const usedNums = [uses(1), uses(2), uses(3)];
    const mapping = new Map<number, number>();
    let seq = 0;
    for (let n = 1; n <= 3; n++) {
      if (usedNums[n - 1]) mapping.set(n, ++seq);
    }
    sql = sql.replace(/\$(\d)/g, (_all, d: string) => `$${mapping.get(Number(d))}`);
    const exec = await c.query(sql, vals);
    const row = exec.rows[0] as Record<string, string | number> | undefined;
    const raw = row == null ? 0 : Object.values(row)[0];
    const value = String(raw);
    await c.query(
      'INSERT INTO metric_snapshots (id, tenant_id, metric_key, period_start, value) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), tenantId, key, p.start, value],
    );
    values.push({ periodStart: p.start, value });
  }
  return { saved: values.length, values };
}

export async function listSnapshots(c: Pg, tenantId: string, key: string, filter: { from?: string; to?: string }): Promise<Array<{ periodStart: string; value: string }>> {
  const conds = ['tenant_id = $1', 'metric_key = $2'];
  const vals: unknown[] = [tenantId, key];
  if (filter.from) { vals.push(filter.from); conds.push(`period_start >= $${vals.length}`); }
  if (filter.to) { vals.push(filter.to); conds.push(`period_start <= $${vals.length}`); }
  const r = await c.query(
    `SELECT period_start, value FROM metric_snapshots WHERE ${conds.join(' AND ')} ORDER BY period_start`,
    vals,
  );
  return (r.rows as Array<{ period_start: string; value: string }>).map((x) => ({ periodStart: String(x.period_start), value: String(x.value) }));
}
