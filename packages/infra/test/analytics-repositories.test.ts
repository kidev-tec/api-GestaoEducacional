/**
 * E06-07 unit — analytics-repositories 100×4 (fake PG).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AnalyticsRuleError, rate, recordTouch, listTouches, computeFunnel, snapshotFunnel, listSnapshots, mapAnalyticsError,
} from '../src/analytics-repositories.js';
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

const STAGE = { id: 'st1', label: 'Novo', kind: 'open', position: 1 };
const TOUCH = { id: 't1', tenant_id: 'T', lead_id: 'l1', campaign: 'c', utm_source: 'fb', utm_medium: 'cpc', first_touch_at: new Date('2026-11-01T00:00:00Z'), last_touch_at: new Date('2026-11-01T00:00:00Z') };

describe('rate (R7)', () => {
  it('normal, div/0 → 0, arredondamento 2 casas', () => {
    expect(rate(1, 4)).toBe(25);
    expect(rate(1, 0)).toBe(0);
    expect(rate(1, 3)).toBe(33.33);
  });
});

describe('recordTouch (R1)', () => {
  const leadOk = (q: Q) => {
    if (q.text.includes('FROM leads WHERE')) return q.values[0] === 'l1' ? [{ id: 'l1' }] : [];
    return [];
  };
  it('404 lead; cria novo touch; replay avança last_touch (append-only)', async () => {
    const { client } = fakeClient(leadOk);
    await expect(recordTouch(client, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
    // cria
    const { client: c2, queries } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1' }];
      if (q.text.includes('FROM lead_source_attribution')) return [];
      if (q.text.includes('INSERT INTO lead_source_attribution')) return [TOUCH];
      return [];
    });
    const t = await recordTouch(c2, 'T', 'l1', { campaign: 'c', utmSource: 'fb', utmMedium: 'cpc' });
    expect(t.id).toBe('t1');
    const ins = queries.find((q) => q.text.includes('INSERT INTO lead_source_attribution'))!;
    expect(ins.values[3]).toBe('c');
    // replay: existing → UPDATE last_touch
    const { client: c3, queries: q3 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1' }];
      if (q.text.includes('FROM lead_source_attribution') && q.text.includes('FOR UPDATE')) return [{ id: 't1' }];
      if (q.text.trim().startsWith('UPDATE lead_source_attribution')) return [{ ...TOUCH, last_touch_at: new Date('2026-11-02T00:00:00Z') }];
      return [];
    });
    const t2 = await recordTouch(c3, 'T', 'l1', { campaign: 'c', utmSource: 'fb', utmMedium: 'cpc' });
    expect(t2.lastTouchAt).toBe('2026-11-02T00:00:00.000Z');
    expect(t2.firstTouchAt).toBe('2026-11-01T00:00:00.000Z'); // append-only
    expect(q3.find((q) => q.text.trim().startsWith('UPDATE lead_source_attribution'))).toBeTruthy();
  });
});

describe('listTouches', () => {
  it('retorna ordenado', async () => {
    const { client } = fakeClient(() => [TOUCH]);
    const ts = await listTouches(client, 'T', 'l1');
    expect(ts).toHaveLength(1);
    expect(ts[0]!.utmSource).toBe('fb');
  });
});

describe('computeFunnel (R2/R3)', () => {
  const hist = [
    { stage_id: 'st1', entered_at: new Date('2026-11-01T00:00:00Z'), left_at: new Date('2026-11-03T00:00:00Z') }, // 2 dias
    { stage_id: 'st1', entered_at: new Date('2026-11-05T00:00:00Z'), left_at: null }, // ainda no stage
  ];
  it('422 sem funil; counts/rates/avgDays', async () => {
    const { client } = fakeClient(() => []);
    await expect(computeFunnel(client, 'T')).rejects.toThrow(AnalyticsRuleError);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('COUNT(*)::int') && q.text.includes('NOT IN')) return [{ n: 0 }]; // neverMoved
      if (q.text.includes('FROM pipeline_stages')) return [{ ...STAGE }, { id: 'st2', label: 'Ganho', kind: 'won', position: 2 }];
      if (q.text.includes('FROM lead_stage_history')) return hist;
      if (q.text.includes("ps.kind = 'won'")) return [{ n: 1 }];
      return [];
    });
    const f = await computeFunnel(c2, 'T');
    expect(f.unitId).toBeNull();
    const st1 = f.stages.find((s) => s.stageId === 'st1')!;
    expect(st1.entered).toBe(2);
    expect(st1.left).toBe(1);
    expect(st1.avgDays).toBe(2); // 1 left com 2 dias
    expect(f.stages.find((s) => s.stageId === 'GLOBAL')!.conversionRate).toBe(50); // 1 won / 2 entradas
  });
});

describe('snapshotFunnel / listSnapshots (R4/R5)', () => {
  it('persiste snapshot e retorna payload; lista com unit e limite', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('COUNT(*)::int') && q.text.includes('NOT IN')) return [{ n: 0 }];
      if (q.text.includes('FROM pipeline_stages')) return [{ ...STAGE }];
      if (q.text.includes('FROM lead_stage_history')) return [];
      if (q.text.includes("ps.kind = 'won'")) return [{ n: 0 }];
      if (q.text.includes('INSERT INTO funnel_snapshots')) return [{ id: 'snap1', computed_at: new Date('2026-11-11T12:00:00Z') }];
      return [];
    });
    const snap = await snapshotFunnel(client, 'T');
    expect(snap.id).toBe('snap1');
    expect(snap.computedAt).toBe('2026-11-11T12:00:00.000Z');
    expect(snap.payload.stages.length).toBeGreaterThan(0);
    const ins = queries.find((q) => q.text.includes('INSERT INTO funnel_snapshots'))!;
    expect(ins.values[2]).toBeNull(); // unit NULL
    // lista com unit
    const { client: c2, queries: q2 } = fakeClient(() => [{ id: 's1', computed_at: new Date('2026-11-11T12:00:00Z'), unit_id: 'u1', payload: {} }]);
    const snaps = await listSnapshots(c2, 'T', 'u1', 5);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.unitId).toBe('u1');
    expect(q2[0]!.values).toEqual(['T', 'u1', 5]);
    // lista sem unit
    const { client: c3, queries: q3 } = fakeClient(() => []);
    await listSnapshots(c3, 'T', undefined, 20);
    expect(q3[0]!.text).toContain('unit_id IS NULL');
  });
});

describe('branches finais analytics', () => {
  it('paths alternativos: toTouch string/null, won com left, unit filter, iso string', async () => {
    // recordTouch com campaign/utm nulls (?? null paths) — create sem campos
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1' }];
      if (q.text.includes('FROM lead_source_attribution') && q.text.includes('FOR UPDATE')) return [];
      if (q.text.includes('INSERT INTO lead_source_attribution')) return [{ ...TOUCH, campaign: null, utm_source: null, utm_medium: null, first_touch_at: '2026-11-01T00:00:00.000Z', last_touch_at: '2026-11-01T00:00:00.000Z' }];
      return [];
    });
    const t1 = await recordTouch(c1, 'T', 'l1', {});
    expect(t1.campaign).toBeNull();
    expect(t1.firstTouchAt).toBe('2026-11-01T00:00:00.000Z'); // iso com string
    // replay UPDATE com string dates (iso string path)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1' }];
      if (q.text.includes('FROM lead_source_attribution') && q.text.includes('FOR UPDATE')) return [{ id: 't1' }];
      if (q.text.trim().startsWith('UPDATE lead_source_attribution')) return [{ ...TOUCH, first_touch_at: '2026-11-01T00:00:00.000Z', last_touch_at: '2026-11-03T00:00:00.000Z' }];
      return [];
    });
    const t2 = await recordTouch(c2, 'T', 'l1', { campaign: 'c', utmSource: 'fb', utmMedium: 'cpc' });
    expect(t2.lastTouchAt).toBe('2026-11-03T00:00:00.000Z');
    // computeFunnel com unitId (branch $2) e won com left_at null
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('COUNT(*)::int') && q.text.includes('NOT IN')) return [{ n: 0 }];
      if (q.text.includes('FROM pipeline_stages')) return [{ ...STAGE }, { id: 'st2', label: 'Ganho', kind: 'won', position: 2 }];
      if (q.text.includes('FROM lead_stage_history')) return [{ stage_id: 'st2', entered_at: new Date('2026-11-01T00:00:00Z'), left_at: null }];
      if (q.text.includes("ps.kind = 'won'")) return [{ n: 1 }];
      return [];
    });
    const f = await computeFunnel(c3, 'T', 'u1');
    expect(f.unitId).toBe('u1');
    const g = f.stages.find((s) => s.stageId === 'GLOBAL')!;
    expect(g.won).toBe(1);
    // stage desconhecido no history (continue path)
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('COUNT(*)::int') && q.text.includes('NOT IN')) return [{ n: 0 }];
      if (q.text.includes('FROM pipeline_stages')) return [{ ...STAGE }];
      if (q.text.includes('FROM lead_stage_history')) return [{ stage_id: 'unknown', entered_at: new Date(), left_at: null }];
      if (q.text.includes("ps.kind = 'won'")) return [{ n: 0 }];
      return [];
    });
    const f2 = await computeFunnel(c4, 'T');
    expect(f2.stages.find((s) => s.stageId === 'st1')!.entered).toBe(0);
    // snapshot com iso string (computed_at como string) e listSnapshots sem unit (unit NULL row)
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('COUNT(*)::int') && q.text.includes('NOT IN')) return [{ n: 0 }];
      if (q.text.includes('FROM pipeline_stages')) return [{ ...STAGE }];
      if (q.text.includes('FROM lead_stage_history')) return [];
      if (q.text.includes("ps.kind = 'won'")) return [{ n: 0 }];
      if (q.text.includes('INSERT INTO funnel_snapshots')) return [{ id: 's9', computed_at: '2026-11-11T12:00:00.000Z' }];
      return [];
    });
    const snap = await snapshotFunnel(c5, 'T');
    expect(snap.computedAt).toBe('2026-11-11T12:00:00.000Z');
    const { client: c6 } = fakeClient(() => [{ id: 's1', computed_at: '2026-11-11T12:00:00.000Z', unit_id: null, payload: {} }]);
    const snaps = await listSnapshots(c6, 'T', undefined, 3);
    expect(snaps[0]!.unitId).toBeNull();
    expect(snaps[0]!.computedAt).toBe('2026-11-11T12:00:00.000Z');
  });
});

describe('mapAnalyticsError', () => {
  it('mapeia classes', () => {
    expect(mapAnalyticsError(new AnalyticsRuleError('x')).status).toBe(422);
    expect(mapAnalyticsError(new NotFoundError('x')).status).toBe(404);
    expect(mapAnalyticsError(new Error('x')).status).toBe(500);
  });
});
