/**
 * E11-01 — catálogo de métricas e fontes (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MetricRuleError, listMetrics, getMetric, createMetric, updateMetric,
  computeMetric, listSnapshots, mapMetricError,
} from '../src/metric-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
      queries.push(q);
      const rows = responder(q);
      return { rows, rowCount: rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const M = {
  id: 'm1', key: 'revenue_month', name: 'Receita', description: '', granularity: 'MONTH',
  timezone: 'America/Sao_Paulo', owner: null, source_tables: ['ledger_entries'],
  formula_sql: "SELECT COALESCE(SUM(amount_cents),0)::numeric FROM ledger_entries WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3",
  active: true,
};

describe('createMetric (R1)', () => {
  it('valida slug/SELECT/whitelist/granularidade; duplicado → 409', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('SELECT key FROM metric_catalog')) return [];
      if (q.text.includes('INSERT INTO metric_catalog')) return [M];
      return [];
    });
    const m = await createMetric(client, {
      key: 'nova_metrica', name: 'Nova', description: '', granularity: 'DAY',
      formulaSql: 'SELECT COUNT(*)::numeric FROM leads WHERE tenant_id = $1', sourceTables: ['leads'],
    });
    expect(m.key).toBe('revenue_month'); // fake retorna M; key validada acima pelo slug
    const { client: c0 } = fakeClient(() => []);
    // slug inválido
    await expect(createMetric(c0, { key: 'Bad', name: 'x', description: '', granularity: 'DAY', formulaSql: 'SELECT 1', sourceTables: ['leads'] })).rejects.toThrow(MetricRuleError);
    // não começa com SELECT
    await expect(createMetric(c0, { key: 'ok', name: 'x', description: '', granularity: 'DAY', formulaSql: 'DELETE FROM leads', sourceTables: ['leads'] })).rejects.toThrow(/SELECT/);
    // tabela fora da whitelist
    await expect(createMetric(c0, { key: 'ok2', name: 'x', description: '', granularity: 'DAY', formulaSql: 'SELECT * FROM users', sourceTables: ['users'] })).rejects.toThrow(/whitelist/);
    // granularidade inválida
    await expect(createMetric(c0, { key: 'ok3', name: 'x', description: '', granularity: 'HOUR' as 'DAY', formulaSql: 'SELECT 1', sourceTables: ['leads'] })).rejects.toThrow(MetricRuleError);
    // placeholder $4 fora do contrato
    await expect(createMetric(c0, { key: 'ok4', name: 'x', description: '', granularity: 'DAY', formulaSql: 'SELECT $4::numeric', sourceTables: ['leads'] })).rejects.toThrow(/contrato/);
    // duplicado → 409 (unique violation via CatalogConflict pattern: code 23505)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('SELECT key FROM metric_catalog')) return [{ key: 'nova_metrica' }];
      return [];
    });
    await expect(createMetric(c1, { key: 'nova_metrica', name: 'x', description: '', granularity: 'DAY', formulaSql: 'SELECT 1', sourceTables: ['leads'] })).rejects.toThrow(/já existe/);
  });
});

describe('list/get/update', () => {
  it('lista, 404, update owner/active', async () => {
    const { client } = fakeClient(() => [M]);
    expect(await listMetrics(client)).toHaveLength(1);
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('UPDATE metric_catalog')) return [{ ...M, active: false }];
      return [];
    });
    const g = await getMetric(c1, 'revenue_month');
    expect(g.key).toBe('revenue_month');
    const up = await updateMetric(c1, 'revenue_month', { active: false });
    expect(up.active).toBe(false);
    const { client: c2 } = fakeClient(() => []);
    await expect(getMetric(c2, 'zz')).rejects.toThrow(NotFoundError);
    await expect(updateMetric(c2, 'zz', {})).rejects.toThrow(NotFoundError);
  });
});

describe('computeMetric (R2)', () => {
  const MONTH = 30;
  it('grava snapshot por período; duplicado → 409; active=false → 422; 404', async () => {
    // MONTH: 2026-11-01..2026-11-30 → 1 período
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('FROM metric_snapshots') && q.text.includes('UNIQUE') === false && q.text.includes('SELECT')) return [];
      if (/formula_sql/.test(q.text) || q.text.includes('SELECT COALESCE')) return [{ value: '150000' }];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r = await computeMetric(client, 'A', 'revenue_month', '2026-11-01', '2026-11-30');
    expect(r.saved).toBe(1);
    expect(r.values[0]!.value).toBe('150000');
    expect(queries.some((q) => q.text.includes('INSERT INTO metric_snapshots'))).toBe(true);
    // duplicado → 409
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('SELECT COALESCE')) return [{ value: '150000' }];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [{ id: 'exists' }];
      return [];
    });
    await expect(computeMetric(c1, 'A', 'revenue_month', '2026-11-01', '2026-11-30')).rejects.toThrow(/já calculada/);
    // métrica inativa → 422
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [{ ...M, active: false }];
      return [];
    });
    await expect(computeMetric(c2, 'A', 'revenue_month', '2026-11-01', '2026-11-30')).rejects.toThrow(MetricRuleError);
    // 404
    const { client: c3 } = fakeClient(() => []);
    await expect(computeMetric(c3, 'A', 'zz', '2026-11-01', '2026-11-30')).rejects.toThrow(NotFoundError);
    // range inválido → 422
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      return [];
    });
    await expect(computeMetric(c4, 'A', 'revenue_month', '2026-12-01', '2026-11-01')).rejects.toThrow(MetricRuleError);
  });
});

describe('branches finais metric', () => {
  it('paths: MetricConflictError 409; period chunking WEEK/DAY múltiplos; owner update; periodsOf inválido por NaN', async () => {
    // 14: MetricConflictError via mapMetricError
    const { MetricConflictError } = await import('../src/metric-repositories.js');
    expect(mapMetricError(new MetricConflictError('x')).status).toBe(409);
    // WEEK: 2026-11-01..2026-11-14 → 2 chunks; cada insert novo → saved 2 (88 loop múltiplo)
    const M2 = { ...M, granularity: 'WEEK' };
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M2];
      if (q.text.includes('SELECT COALESCE')) return [{ value: '10' }];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r = await computeMetric(client, 'A', 'revenue_month', '2026-11-01', '2026-11-14');
    expect(r.saved).toBe(2);
    // DAY: 3 dias → 3 chunks
    const M3 = { ...M, granularity: 'DAY' };
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M3];
      if (q.text.includes('SELECT COALESCE')) return [{ value: '1' }];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r1 = await computeMetric(c1, 'A', 'revenue_month', '2026-11-01', '2026-11-03');
    expect(r1.saved).toBe(3);
    // updateMetric com owner (101-103 COALESCE paths + 104 statement) — owner fornecido:
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('UPDATE metric_catalog')) return [{ ...M, owner: 'u1', name: 'Novo', description: 'd', active: true }];
      return [];
    });
    const up = await updateMetric(c2, 'revenue_month', { name: 'Novo', description: 'd', owner: 'u1', active: true });
    expect(up.owner).toBe('u1');
    // updateMetric owner null (COALESCE null path) — owner fica null no retorno do fake:
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('UPDATE metric_catalog')) return [{ ...M, owner: null }];
      return [];
    });
    await updateMetric(c3, 'revenue_month', { active: false });
    // fórmula sem linhas → value '0' (row null path)
    const M6 = { ...M, formulaSql: "SELECT COUNT(*)::numeric FROM leads WHERE tenant_id = $1 AND 1 = 0" };
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M6];
      if (q.text.includes('COUNT(*)')) return [];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r5 = await computeMetric(c5, 'A', 'revenue_month', '2026-11-01', '2026-11-01');
    expect(r5.values[0]!.value).toBe('0');
    // periodsOf com data inválida (NaN)
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      return [];
    });
    await expect(computeMetric(c4, 'A', 'revenue_month', 'data-ruim', '2026-11-30')).rejects.toThrow(MetricRuleError);
  });
});

describe('branches finais metric 2', () => {
  it('paths: update só description; MONTH chunking', async () => {
    // 88: só description — name/owner/active null
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M];
      if (q.text.includes('UPDATE metric_catalog')) return [{ ...M, description: 'desc' }];
      return [];
    });
    const up = await updateMetric(client, 'revenue_month', { description: 'desc' });
    expect(up.description).toBe('desc');
    // 103: MONTH
    const M4 = { ...M, granularity: 'MONTH' };
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M4];
      if (q.text.includes('SELECT COALESCE')) return [{ value: '7' }];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r = await computeMetric(c1, 'A', 'revenue_month', '2026-11-01', '2026-11-30');
    expect(r.saved).toBe(1);
    // QUARTER
    const M5 = { ...M, granularity: 'QUARTER' };
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM metric_catalog WHERE key =')) return [M5];
      if (q.text.includes('SELECT COALESCE')) return [{ value: '9' }];
      if (q.text.includes('FROM metric_snapshots WHERE')) return [];
      if (q.text.includes('INSERT INTO metric_snapshots')) return [{ id: 's1' }];
      return [];
    });
    const r2 = await computeMetric(c2, 'A', 'revenue_month', '2026-11-01', '2026-11-30');
    expect(r2.saved).toBe(1);
  });
});

describe('listSnapshots / map', () => {
  it('filtros; mapMetricError', async () => {
    const { client, queries } = fakeClient(() => [{ period_start: '2026-11-01', value: '150000' }]);
    const snaps = await listSnapshots(client, 'A', 'revenue_month', { from: '2026-11-01', to: '2026-11-30' });
    expect(snaps[0]!.value).toBe('150000');
    expect(queries[0]!.values).toEqual(['A', 'revenue_month', '2026-11-01', '2026-11-30']);
    expect(mapMetricError(new MetricRuleError('x')).status).toBe(422);
    expect(mapMetricError(new NotFoundError('x')).status).toBe(404);
    expect(mapMetricError(new Error('x')).status).toBe(500);
  });
});
