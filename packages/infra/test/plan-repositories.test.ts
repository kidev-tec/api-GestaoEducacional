import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  UNLIMITED, PlanRuleError, assignPlan, countStudents,
  entitledModules, createCommercialPlan, currentPlan, planLimit, listCommercialPlans,
} from '../src/plan-repositories.js';

interface Call { text: string; values?: unknown[] }

/** Router fake por trecho SQL — rotas específicas primeiro. */
function fakeClient(routes: [RegExp, (c: Call) => { rows: Record<string, unknown>[]; rowCount: number }][]): { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      for (const [re, fn] of routes) if (re.test(text)) return fn({ text, values: values ?? [] });
      return { rows: [], rowCount: 0 };
    },
  };
}
const W = (rows: Record<string, unknown>[], n?: number) => ({ rows, rowCount: n ?? rows.length });

const pool = {} as Pool;
let poolImpl: (text: string, values: unknown[]) => { rows: Record<string, unknown>[]; rowCount: number } = () => W([]);
(pool as unknown as { query: unknown }).query = (text: string, values?: unknown[]) => Promise.resolve(poolImpl(text, values ?? []));
const setPool = (fn: typeof poolImpl) => { poolImpl = fn; };

describe('createCommercialPlan', () => {
  it('cria plano com módulos e limites', async () => {
    const seen: Call[] = [];
    const client = fakeClient([
      [/INSERT INTO plans/, (c) => { seen.push(c); return W([{ id: 'p1', code: 'starter', name: 'Starter', price_cents: 9900, active: true }]); }],
      [/INSERT INTO plan_modules/, (c) => { seen.push(c); return W([]); }],
      [/INSERT INTO plan_limits/, (c) => { seen.push(c); return W([]); }],
    ]);
    const plan = await createCommercialPlan(client, { code: 'starter', name: 'Starter', priceCents: 9900, modules: ['crm'], limits: { max_students: 50 } });
    expect(plan.id).toBe(client.calls[0].values?.[0]); // id gerado = 1º param do INSERT
    expect(plan.code).toBe('starter');
    expect(plan.modules).toEqual(['crm']);
    expect(plan.limits.max_students).toBe(50);
    expect(seen[0].values).toEqual([expect.any(String), 'starter', 'Starter', 9900]);
  });

  it('cria plano mínimo sem módulos/limites', async () => {
    const client = fakeClient([[/INSERT INTO plans/, () => W([{ id: 'x' }])]]);
    const p = await createCommercialPlan(client, { code: 'free', name: 'Free', priceCents: 0 });
    expect(p.modules).toEqual([]);
    expect(p.limits).toEqual({});
    expect(client.calls).toHaveLength(1);
  });

  it('code duplicado → ConflictError', async () => {
    const client = fakeClient([[/INSERT INTO plans/, () => W([], 0)]]);
    await expect(createCommercialPlan(client, { code: 'starter', name: 'X', priceCents: 0 })).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('code inválido / preço inválido / limite inválido → PlanRuleError', async () => {
    const client = fakeClient([[/INSERT INTO plans/, () => W([{ id: 'x' }])]]);
    await expect(createCommercialPlan(client, { code: 'UPPER', name: 'X', priceCents: 0 })).rejects.toBeInstanceOf(PlanRuleError);
    await expect(createCommercialPlan(client, { code: 'ok-code', name: 'X', priceCents: 10.5 })).rejects.toBeInstanceOf(PlanRuleError);
    await expect(createCommercialPlan(client, { code: 'ok-code', name: 'X', priceCents: -1 })).rejects.toBeInstanceOf(PlanRuleError);
    await expect(createCommercialPlan(client, { code: 'ok-code', name: 'X', priceCents: 1, limits: { max_students: -2 } })).rejects.toBeInstanceOf(PlanRuleError);
    await expect(createCommercialPlan(client, { code: 'ok-code', name: 'X', priceCents: 1, limits: { 'bad-key': 5 } })).rejects.toBeInstanceOf(PlanRuleError);
  });
});

describe('assignPlan / currentPlan', () => {
  it('assign encerra vigência anterior e insere nova', async () => {
    const seen: Call[] = [];
    const client = fakeClient([
      [/SELECT id FROM plans/, () => W([{ id: 'p2' }])],
      [/UPDATE tenant_plans/, (c) => { seen.push(c); return W([], 1); }],
      [/INSERT INTO tenant_plans/, (c) => { seen.push(c); return W([]); }],
    ]);
    await assignPlan(client as never, 't1', 'p2', '2026-01-01T00:00:00Z');
    expect(seen.map((c) => c.text)).toEqual([
      expect.stringContaining('SET ended_at'),
      expect.stringContaining('INSERT INTO tenant_plans'),
    ]);
    expect(seen[0].values).toEqual(['t1', '2026-01-01T00:00:00Z']);
    expect(seen[1].values).toEqual(['t1', 'p2', '2026-01-01T00:00:00Z']);
  });

  it('assign plano inexistente/inativo → NotFoundError', async () => {
    const client = fakeClient([[/SELECT id FROM plans/, () => W([], 0)]]);
    await expect(assignPlan(client as never, 't1', 'ghost')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('currentPlan retorna vigente com mods+limits; sem plano → null', async () => {
    setPool((t) => {
      if (/ended_at IS NULL/.test(t)) {
        if (/SELECT p\.id/.test(t)) return W([{ id: 'p1', code: 'starter', name: 'S', price_cents: 100, active: true }]);
      }
      if (/plan_modules WHERE/.test(t)) return W([{ module: 'crm' }, { module: 'finance' }]);
      if (/plan_limits WHERE/.test(t)) return W([{ limit_key: 'max_students', limit_value: 50 }]);
      return W([], 0);
    });
    const plan = await currentPlan(pool, 't1');
    expect(plan?.code).toBe('starter');
    expect(plan?.modules).toEqual(['crm', 'finance']);
    expect(plan?.limits).toEqual({ max_students: 50 });

    setPool(() => W([], 0));
    expect(await currentPlan(pool, 't1')).toBeNull();
  });
});

describe('grandfathering', () => {
  it('entitledModules = union distinta de todos os planos do tenant', async () => {
    setPool((t) => {
      if (/DISTINCT pm\.module/.test(t)) return W([{ module: 'finance' }, { module: 'crm' }, { module: 'finance' }]);
      return W([], 0);
    });
    expect(await entitledModules(pool, 't1')).toEqual(['crm', 'finance']);
  });
});

describe('planLimit / countStudents', () => {
  it('sem plano → UNLIMITED (trial); com limite → valor; sem key → UNLIMITED', async () => {
    let planRow: Record<string, unknown>[] = [{ id: 'p1', code: 's', name: 'S', price_cents: 0, active: true }];
    setPool((t) => {
      if (/ended_at IS NULL/.test(t) && /SELECT p\.id/.test(t)) return W(planRow);
      if (/plan_limits WHERE/.test(t)) return W([{ limit_key: 'max_students', limit_value: 50 }]);
      return W([], 0);
    });
    expect(await planLimit(pool, 't1', 'max_students')).toBe(50);
    expect(await planLimit(pool, 't1', 'other_key')).toBe(UNLIMITED);
    planRow = []; // sem plano — UNLIMITED agora
    expect(await planLimit(pool, 't1', 'max_students')).toBe(UNLIMITED);
  });

  it('countStudents usa índice tenant+kind', async () => {
    setPool((t) => {
      if (/COUNT\(\*\)/.test(t)) return W([{ n: 7 }]);
      return W([], 0);
    });
    expect(await countStudents(pool, 't1')).toBe(7);
  });
});

describe('listCommercialPlans', () => {
  it('lista vazia não consulta relações', async () => {
    setPool((t) => {
      if (/FROM plans ORDER BY/.test(t)) return W([], 0);
      throw new Error('não deve consultar relações sem planos');
    });
    expect(await listCommercialPlans(pool as never)).toEqual([]);
  });

  it('agrega módulos e limites por plano', async () => {
    setPool((t) => {
      if (/FROM plans ORDER BY/.test(t)) return W([
        { id: 'p1', code: 'starter', name: 'S', price_cents: 100, active: true },
        { id: 'p2', code: 'pro', name: 'P', price_cents: 200, active: true },
      ]);
      if (/FROM plan_modules/.test(t)) return W([{ plan_id: 'p1', module: 'crm' }, { plan_id: 'p2', module: 'finance' }, { plan_id: 'p2', module: 'crm' }]);
      if (/FROM plan_limits/.test(t)) return W([{ plan_id: 'p1', limit_key: 'max_students', limit_value: 10 }, { plan_id: 'p2', limit_key: 'max_students', limit_value: -1 }]);
      return W([], 0);
    });
    const plans = await listCommercialPlans(pool as never);
    expect(plans.map((p) => p.code)).toEqual(['starter', 'pro']);
    expect(plans[1].modules).toEqual(['finance', 'crm']);
    expect(plans[1].limits).toEqual({ max_students: -1 });
  });

  it('plano sem relações retorna coleções vazias', async () => {
    setPool((t) => {
      if (/FROM plans ORDER BY/.test(t)) return W([{ id: 'bare', code: 'bare', name: 'B', price_cents: 0, active: true }]);
      return W([], 0);
    });
    await expect(listCommercialPlans(pool as never)).resolves.toMatchObject([{ modules: [], limits: {} }]);
  });

  it('agrega módulos e limites por plano (duplicados preservados no catálogo)', async () => {
    setPool((t) => {
      if (/FROM plans ORDER BY/.test(t)) return W([
        { id: 'p1', code: 'starter', name: 'S', price_cents: 100, active: true },
        { id: 'p2', code: 'pro', name: 'P', price_cents: 200, active: true },
      ]);
      if (/FROM plan_modules/.test(t)) return W([{ plan_id: 'p1', module: 'crm' }, { plan_id: 'p2', module: 'finance' }, { plan_id: 'p2', module: 'crm' }]);
      if (/FROM plan_limits/.test(t)) return W([{ plan_id: 'p1', limit_key: 'max_students', limit_value: 10 }, { plan_id: 'p2', limit_key: 'max_students', limit_value: -1 }]);
      return W([], 0);
    });
    const plans = await listCommercialPlans(pool as never);
    expect(plans.map((p) => p.code)).toEqual(['starter', 'pro']);
    expect(plans[1].modules).toEqual(['finance', 'crm']);
    expect(plans[1].limits).toEqual({ max_students: -1 });
  });
});
