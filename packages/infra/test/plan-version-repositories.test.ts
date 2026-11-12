import { describe, it, expect, vi } from 'vitest';
import {
  createPlanVersion, publishPlanVersion, listPlanVersions, getPlanVersion, quotePlan,
  getSubscription, upsertSubscription,
} from '../src/plan-version-repositories';

// fake PG — router por trecho SQL; rotas específicas primeiro
function mkDb(routes: [RegExp, any[]][] = []) {
  const calls: any[] = [];
  const db: any = {
    calls,
    query: vi.fn(async (sql: string, values?: any[]) => {
      calls.push({ sql, values });
      for (const [re, res] of routes) if (re.test(sql)) return { rows: res };
      if (/RETURNING/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
  return db;
}

const base = {
  id: 'pv1', key: 'essencial', version: 1, name: 'Essencial', plan_type: 'STANDARD',
  billing_period: 'MONTHLY', unit_price_cents: 20000, seat_price_cents: 5000,
  min_units: 1, max_units: null, trial_days: 0, published: true,
  effective_from: '2026-01-01', effective_to: null, notes: null, created_at: new Date('2026-01-01'),
};

describe('createPlanVersion', () => {
  const input = {
    key: 'essencial', name: 'Essencial', planType: 'STANDARD', billingPeriod: 'MONTHLY',
    unitPriceCents: 20000, seatPriceCents: 5000, limits: [{ key: 'max_students', value: 300 }],
  };

  it('cria versão = max(version)+1 com limites', async () => {
    const db = mkDb([
      [/MAX\(version\)/, [{ v: 4 }]], // SQL já soma +1: max=3 → próxima=4
      [/RETURNING \*/, [base]],
    ]);
    const p = await createPlanVersion(db, input);
    expect(p.key).toBe('essencial');
    const insert = db.calls.find((c: { sql: string }) => c.sql.includes('INSERT INTO plan_versions'))!;
    expect(insert.values[1]).toBe(4); // version = max+1
    expect(db.calls.some((c) => c.sql.includes('plan_version_limits'))).toBe(true);
  });

  it('rejeita preço negativo antes do banco', async () => {
    const db = mkDb();
    await expect(createPlanVersion(db, { ...input, unitPriceCents: -1, seatPriceCents: undefined, limits: undefined })).rejects.toThrow(/pre[çc]o/i);
    expect(db.calls.length).toBe(0);
  });

  it('rejeita seatPrice negativo', async () => {
    const db = mkDb();
    await expect(createPlanVersion(db, { ...input, seatPriceCents: -5, limits: undefined })).rejects.toThrow(/assento/i);
  });

  it('PILOT exige trialDays > 0', async () => {
    const db = mkDb();
    await expect(createPlanVersion(db, { ...input, planType: 'PILOT', unitPriceCents: 0, seatPriceCents: undefined, limits: undefined, trialDays: 0 })).rejects.toThrow(/trial/i);
  });

  it('max_units < min_units → erro', async () => {
    const db = mkDb();
    await expect(createPlanVersion(db, { ...input, maxUnits: 1, minUnits: 3, seatPriceCents: undefined, limits: undefined })).rejects.toMatchObject({ name: 'PlanRuleError' });
  });
});

describe('publishPlanVersion', () => {
  it('publica e fecha vigência anterior', async () => {
    const db = mkDb([[/UPDATE plan_versions/, [base]]]);
    const p = await publishPlanVersion(db, 'pv1');
    expect(db.calls.some((c) => c.sql.includes('SET published = true'))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes('effective_to'))).toBe(true);
    expect(p.id).toBe('pv1');
  });

  it('inexistente → NotFoundError', async () => {
    const db = mkDb([[/UPDATE plan_versions/, []]]);
    await expect(publishPlanVersion(db, 'px')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('listPlanVersions', () => {
  it('sem ?all: só published', async () => {
    const db = mkDb([[/FROM plan_versions/, [base]]]);
    await listPlanVersions(db, { includeUnpublished: false });
    expect(db.calls[0].sql).toContain('published = true');
  });

  it('com ?all: inclui rascunhos', async () => {
    const db = mkDb([[/FROM plan_versions/, [base]]]);
    await listPlanVersions(db, { includeUnpublished: true });
    expect(db.calls[0].sql).not.toContain('published = true');
  });
});

describe('getPlanVersion', () => {
  it('traz limites junto', async () => {
    const db = mkDb([[/plan_version_limits/, [{ ...base, limit_key: 'max_students', limit_value: 300 }]]]);
    const p = await getPlanVersion(db, 'pv1');
    expect(p.limits).toEqual([{ key: 'max_students', value: 300 }]);
  });

  it('sem limites → []', async () => {
    const db = mkDb([[/plan_version_limits/, [base]]]);
    const p = await getPlanVersion(db, 'pv1');
    expect(p.limits).toEqual([]);
  });

  it('inexistente → NotFoundError', async () => {
    const db = mkDb([[/plan_version_limits/, []]]);
    await expect(getPlanVersion(db, 'px')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

describe('quotePlan — simulador transparente', () => {
  it('STANDARD mensal: unidades + assentos itemizado', async () => {
    const db = mkDb([[/FROM plan_versions/, [base]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 3, seats: 10 });
    expect(q.lines).toEqual([
      { label: `Unidades (3 × ${brl(20000)})`, amount: 60000 },
      { label: `Assentos (10 × ${brl(5000)})`, amount: 50000 },
    ]);
    expect(q.totalCents).toBe(110000);
  });

  it('anual: 12 meses com desconto de 2 explícito', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, billing_period: 'ANNUAL', seat_price_cents: null }]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 3, seats: 0 });
    expect(q.lines[0]).toEqual({ label: `Unidades (3 × ${brl(20000)} × 12)`, amount: 720000 });
    expect(q.lines[1]).toEqual({ label: 'Desconto anual (2 meses)', amount: -120000 });
    expect(q.totalCents).toBe(600000);
  });

  it('PILOT: total 0, trial_days no breakdown', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, plan_type: 'PILOT', trial_days: 14, unit_price_cents: 20000 }]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 2, seats: 0 });
    expect(q.lines.some((l: any) => l.label.includes('Trial 14 dias'))).toBe(true);
    expect(q.totalCents).toBe(0);
  });

  it('FRANCHISE com override usa preço negociado', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, plan_type: 'FRANCHISE', unit_price_cents: 30000 }]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 4, seats: 0, priceOverrideCents: 10000 });
    expect(q.lines[0].label).toContain('preço negociado');
    expect(q.lines[0].amount).toBe(40000);
  });

  it('FRANCHISE sem override usa preço do plano', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, plan_type: 'FRANCHISE', unit_price_cents: 30000 }]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 4, seats: 0 });
    expect(q.lines[0].amount).toBe(120000);
  });

  it('unidades < min → erro de domínio', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, min_units: 2 }]]]);
    await expect(quotePlan(db, { planId: 'pv1', units: 1, seats: 0 })).rejects.toMatchObject({ name: 'PlanRuleError' });
  });

  it('unidades > max → erro de domínio', async () => {
    const db = mkDb([[/FROM plan_versions/, [{ ...base, max_units: 5 }]]]);
    await expect(quotePlan(db, { planId: 'pv1', units: 6, seats: 0 })).rejects.toMatchObject({ name: 'PlanRuleError' });
  });

  it('plano inexistente → NotFoundError', async () => {
    const db = mkDb([[/FROM plan_versions/, []]]);
    await expect(quotePlan(db, { planId: 'px', units: 1, seats: 0 })).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('seats < 0 → erro de domínio antes do banco', async () => {
    const db = mkDb([[/FROM plan_versions/, [base]]]);
    await expect(quotePlan(db, { planId: 'pv1', units: 1, seats: -1 })).rejects.toMatchObject({ name: 'PlanRuleError' });
    expect(db.calls.length).toBe(0);
  });
});

describe('subscriptions', () => {
  const sub = {
    id: 's1', tenant_id: 't1', plan_version_id: 'pv1', status: 'ACTIVE', started_at: '2026-01-01',
    current_period_end: '2026-12-31', price_override_cents: null, created_at: new Date(), updated_at: new Date(),
  };

  it('getSubscription por tenant', async () => {
    const db = mkDb([[/tenant_subscriptions/, [sub]]]);
    const s = await getSubscription(db, 't1');
    expect(s.tenantId).toBe('t1');
  });

  it('sem assinatura → null', async () => {
    const db = mkDb([[/tenant_subscriptions/, []]]);
    expect(await getSubscription(db, 't1')).toBeNull();
  });

  it('upsert cria', async () => {
    const db = mkDb([[/RETURNING/, [sub]]]);
    const s = await upsertSubscription(db, { tenantId: 't1', planVersionId: 'pv1', status: 'ACTIVE', currentPeriodEnd: '2026-12-31' });
    expect(s.status).toBe('ACTIVE');
    expect(db.calls[0].sql).toContain('INSERT INTO tenant_subscriptions');
  });

  it('status inválido → erro antes do banco', async () => {
    const db = mkDb();
    await expect(upsertSubscription(db, { tenantId: 't1', planVersionId: 'pv1', status: 'EXPIRED' as any })).rejects.toMatchObject({ name: 'PlanRuleError' });
    expect(db.calls.length).toBe(0);
  });
});

describe('branches finais plan-version', () => {
  const baseRow = {
    id: 'pv1', key: 'essencial', version: 1, name: 'Essencial', plan_type: 'STANDARD',
    billing_period: 'MONTHLY', unit_price_cents: 20000, seat_price_cents: null,
    min_units: 1, max_units: null, trial_days: 0, published: false,
    effective_from: new Date('2026-01-01'), effective_to: new Date('2026-06-01'),
    notes: 'nota', created_at: new Date(),
  };
  const pvInput = { key: 'essencial', name: 'E', planType: 'STANDARD' as const, billingPeriod: 'MONTHLY' as const, unitPriceCents: 100 };

  it('toPlanVersion com datas e todos os campos', async () => {
    const db = mkDb([[/FROM plan_versions pv/, [{ ...baseRow, limit_key: null, limit_value: null }]]]);
    const p = await getPlanVersion(db, 'pv1');
    expect(p.effectiveFrom).toBe('2026-01-01');
    expect(p.effectiveTo).toBe('2026-06-01');
    expect(p.notes).toBe('nota');
    expect(p.limits).toEqual([]);
  });

  it('toPlanVersion com strings (não-Date) e nulls', async () => {
    const db = mkDb([[/FROM plan_versions pv/, [{ ...baseRow, effective_from: '2026-02-02', effective_to: '2026-07-07', created_at: '2026-02-02T10:00:00Z', limit_key: null, limit_value: null }]]]);
    const p = await getPlanVersion(db, 'pv1');
    expect(p.effectiveFrom).toBe('2026-02-02');
    expect(p.effectiveTo).toBe('2026-07-07');
    expect(p.createdAt).toBe('2026-02-02T10:00:00Z');
  });

  it('subscription com datas Date e nulls', async () => {
    const db = mkDb([[/tenant_subscriptions/, [{
      id: 's1', tenant_id: 't1', plan_version_id: 'pv1', status: 'TRIAL',
      started_at: new Date('2026-01-01'), current_period_end: null, price_override_cents: 5000,
      created_at: new Date(), updated_at: new Date(),
    }]]]);
    const s = await getSubscription(db, 't1');
    expect(s.startedAt).toBe('2026-01-01');
    expect(s.currentPeriodEnd).toBeNull();
    expect(s.priceOverrideCents).toBe(5000);
  });

  it('subscription com strings legadas', async () => {
    const db = mkDb([[/tenant_subscriptions/, [{
      id: 's1', tenant_id: 't1', plan_version_id: 'pv1', status: 'CANCELED',
      started_at: '2026-01-01', current_period_end: '2026-03-01', price_override_cents: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    }]]]);
    const s = await getSubscription(db, 't1');
    expect(s.startedAt).toBe('2026-01-01');
    expect(s.currentPeriodEnd).toBe('2026-03-01');
  });

  it('createPlanVersion: INSERT sem RETURNING row → conflito 409', async () => {
    const db = mkDb([[/MAX\(version\)/, [{ v: 2 }]], [/INSERT INTO plan_versions/, []]]);
    await expect(createPlanVersion(db, pvInput)).rejects.toMatchObject({ name: 'PlanVersionConflictError' });
  });

  it('createPlanVersion com todos os opcionais definidos', async () => {
    const db = mkDb([[/MAX\(version\)/, [{ v: 1 }]], [/INSERT INTO plan_versions/, [baseRow]]]);
    await createPlanVersion(db, {
      ...pvInput, seatPriceCents: 5000, minUnits: 2, maxUnits: 10, trialDays: 5, notes: 'x',
      limits: [{ key: 'max_students', value: null }, { key: 'max_teachers', value: 40 }],
    });
    const ins = db.calls.find((c: { sql: string }) => c.sql.includes('INSERT INTO plan_versions'))!;
    expect(ins.values).toEqual(['essencial', 1, 'E', 'STANDARD', 'MONTHLY', 100, 5000, 2, 10, 5, 'x']);
    expect(db.calls.filter((c: { sql: string }) => c.sql.includes('plan_version_limits')).length).toBe(2);
  });

  it('quotePlan: assentos com seatPrice null/0 ignorados; mensal sem sufixo ×12', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [{ ...baseRow, seat_price_cents: 0 }]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 2, seats: 99 });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]!.label).not.toContain('× 12');
    expect(q.totalCents).toBe(40000);
  });

  it('publishPlanVersion: versão ausente → NotFoundError', async () => {
    const db = mkDb([[/UPDATE plan_versions SET published = true/, []]]);
    await expect(publishPlanVersion(db, 'x')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('branches residuais plan-version', () => {
  const baseRow = {
    id: 'pv1', key: 'essencial', version: 1, name: 'Essencial', plan_type: 'FRANCHISE',
    billing_period: 'ANNUAL', unit_price_cents: 20000, seat_price_cents: 5000,
    min_units: 1, max_units: null, trial_days: 0, published: true,
    effective_from: '2026-01-01', effective_to: null, notes: null, created_at: '2026-01-01T00:00:00Z',
  };
  const subRow = {
    id: 's1', tenant_id: 't1', plan_version_id: 'pv1', status: 'ACTIVE',
    started_at: '2026-01-01', current_period_end: new Date('2027-01-01'), price_override_cents: null,
    created_at: new Date(), updated_at: new Date(),
  };

  it('PILOT com trialDays válido passa pelo guard', async () => {
    const db = mkDb([[/MAX\(version\)/, [{ v: 1 }]], [/INSERT INTO plan_versions/, [baseRow]]]);
    await createPlanVersion(db, { key: 'pilot-ok', name: 'P', planType: 'PILOT', billingPeriod: 'MONTHLY', unitPriceCents: 0, trialDays: 30 });
    expect(db.calls.some((c: { sql: string }) => c.sql.includes('INSERT INTO plan_versions'))).toBe(true);
  });

  it('createPlanVersion sem limits pula loop', async () => {
    const db = mkDb([[/MAX\(version\)/, [{ v: 1 }]], [/INSERT INTO plan_versions/, [baseRow]]]);
    await createPlanVersion(db, { key: 'nl', name: 'N', planType: 'STANDARD', billingPeriod: 'MONTHLY', unitPriceCents: 1 });
    expect(db.calls.filter((c: { sql: string }) => c.sql.includes('plan_version_limits')).length).toBe(0);
  });

  it('quotePlan anual com assentos inclui × 12', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [baseRow]]]);
    const q = await quotePlan(db, { planId: 'pv1', units: 1, seats: 2 });
    const seat = q.lines.find((l) => l.label.includes('Assentos'))!;
    expect(seat.label).toContain('× 12');
    expect(seat.amount).toBe(120000);
  });

  it('subscription current_period_end Date', async () => {
    const db = mkDb([[/tenant_subscriptions/, [subRow]]]);
    expect((await getSubscription(db, 't1')).currentPeriodEnd).toBe('2027-01-01');
  });

  it('upsert sem opcionais → null', async () => {
    const db = mkDb([[/RETURNING/, [subRow]]]);
    await upsertSubscription(db, { tenantId: 't1', planVersionId: 'pv1', status: 'ACTIVE' });
    const ins = db.calls.find((c: { sql: string }) => c.sql.includes('INSERT INTO tenant_subscriptions'))!;
    expect(ins.values[3]).toBeNull();
    expect(ins.values[4]).toBeNull();
  });
});
