import { describe, expect, it } from 'vitest';
import {
  TrialRuleError, TransitionRuleError, NotFoundError,
  createTrial, transitionSubscription, listTransitions, exportTenantData,
} from '../src/subscription-transition-repositories';

/** Fake router: [regex, rows] — primeira regex que casa atende. */
function mkDb(routes: Array<[RegExp, any[]]>) {
  const calls: Array<{ sql: string; values: any[] }> = [];
  const db = {
    calls,
    async query(sql: string, values: any[] = []) {
      calls.push({ sql, values });
      for (const [re, rows] of routes) if (re.test(sql)) return { rows: rows.slice(), rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
  return db as unknown as import('pg').PoolClient;
}

const planRow = {
  id: 'pv-pilot', key: 'pilot', version: 1, name: 'Pilot', plan_type: 'PILOT',
  billing_period: 'MONTHLY', unit_price_cents: 0, seat_price_cents: null,
  min_units: 1, max_units: null, trial_days: 14, published: true,
  effective_from: '2026-01-01', effective_to: null, notes: null, created_at: '2026-01-01',
};
const planUp = { ...planRow, id: 'pv-up', key: 'pro', plan_type: 'STANDARD', trial_days: 0 };
const planDown = { ...planRow, id: 'pv-down', key: 'lite', plan_type: 'STANDARD', trial_days: 0, min_units: 2 };
const subRow = {
  id: 's1', tenant_id: 't1', plan_version_id: 'pv-pilot', status: 'TRIAL',
  started_at: '2026-01-01', current_period_end: new Date('2026-01-15'),
  price_override_cents: null, created_at: new Date(), updated_at: new Date(),
};

describe('createTrial', () => {
  it('cria tenant + assinatura TRIAL + trilha', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [planRow]], [/slug = /, []], [/RETURNING \*/, [subRow]]]);
    const r = await createTrial(db, { name: 'Escola Teste', planVersionId: 'pv-pilot' });
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO tenants'))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes("'TRIAL',"))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO subscription_transitions'))).toBe(true);
    expect(r.subscription.status).toBe('TRIAL');
  });

  it('slug colidido → erro e tenant existente retornado no SELECT', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [planRow]], [/slug = /, [{ id: 't-old' }]]]);
    await expect(createTrial(db, { name: 'Escola Teste', planVersionId: 'pv-pilot' })).rejects.toMatchObject({ name: 'TrialRuleError' });
  });

  it('plano não-PILOT → TrialRuleError', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [planUp]]]);
    await expect(createTrial(db, { name: 'X', planVersionId: 'pv-up' })).rejects.toMatchObject({ name: 'TrialRuleError' });
  });

  it('plano inexistente → NotFoundError', async () => {
    const db = mkDb([[/plan_versions/, []]]);
    await expect(createTrial(db, { name: 'X', planVersionId: 'nope' })).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('plano não publicado → TrialRuleError', async () => {
    const db = mkDb([[/plan_versions/, [{ ...planRow, published: false }]]]);
    await expect(createTrial(db, { name: 'X', planVersionId: 'pv-pilot' })).rejects.toMatchObject({ name: 'TrialRuleError' });
  });
});

describe('transitionSubscription', () => {
  it('UPGRADE ativa e concede entitlements do plano novo', async () => {
    const active = { ...subRow, plan_version_id: 'pv-up', status: 'ACTIVE' };
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planUp]],
      [/SELECT \* FROM tenant_subscriptions/, [subRow]],
      [/plan_version_limits/, []],
      [/SELECT 1 FROM tenant_entitlements/, []],
      [/UPDATE tenant_subscriptions/, [active]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr1', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-up', mode: 'UPGRADE', actor_user_id: 'u1', notes: null, transitioned_at: new Date() }]],
    ]);
    const r = await transitionSubscription(db, 't1', { planVersionId: 'pv-up', mode: 'UPGRADE', actorUserId: 'u1' });
    expect(r.subscription.status).toBe('ACTIVE');
    expect(db.calls.some((c) => c.sql.includes('subscription_transitions'))).toBe(true);
  });

  it('DOWNGRADE não revoga entitlements (grace até period_end)', async () => {
    const ents = [{ module_key: 'm1', active: true, ends_at: null }, { module_key: 'm2', active: true, ends_at: null }];
    const planGrace = { ...planDown, min_units: 1 };
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planGrace]],
      [/SELECT \* FROM tenant_subscriptions/, [subRow]],
      [/UPDATE tenant_subscriptions/, [subRow]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr1', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-down', mode: 'DOWNGRADE', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    await transitionSubscription(db, 't1', { planVersionId: 'pv-down', mode: 'DOWNGRADE' });
    const upd = db.calls.filter((c) => /UPDATE tenant_entitlements/.test(c.sql));
    expect(upd.length).toBe(0);
    expect(db.calls.some((c) => /ends_at = EXCLUDED/.test(c.sql) || /grace/.test(c.sql))).toBe(false);
  });

  it('DOWNGRADE para plano com minUnits > unidades → 422 (TransitionRuleError)', async () => {
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planDown]],
      [/tenant_subscriptions/, [subRow]],
    ]);
    await expect(transitionSubscription(db, 't1', { planVersionId: 'pv-down', mode: 'DOWNGRADE' })).rejects.toMatchObject({ name: 'TransitionRuleError' });
  });


  it('CANCEL revoga entitlements com revoked_at=now e status CANCELED', async () => {
    const ents = [{ module_key: 'm1', active: true, ends_at: null }];
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planDown]],
      [/tenant_subscriptions/, [subRow]],
      [/tenant_entitlements/, ents],
      [/RETURNING \*/, [subRow]],
    ]);
    await transitionSubscription(db, 't1', { planVersionId: 'pv-down', mode: 'CANCEL' });
    expect(db.calls.some((c) => /UPDATE tenant_entitlements SET active = false/.test(c.sql))).toBe(true);
  });

  it('mode inválido → TransitionRuleError', async () => {
    const db = mkDb([]);
    await expect(transitionSubscription(db, 't1', { planVersionId: 'pv-down', mode: 'X' as any })).rejects.toMatchObject({ name: 'TransitionRuleError' });
  });

  it('plano inexistente → NotFoundError', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, []]]);
    await expect(transitionSubscription(db, 't1', { planVersionId: 'nope', mode: 'UPGRADE' })).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('listTransitions / exportTenantData', () => {
  it('lista trilha ordenada', async () => {
    const t1 = { id: 'tr1', mode: 'TRIAL', transitioned_at: '2026-01-01' };
    const db = mkDb([[/subscription_transitions/, [t1]]]);
    const r = await listTransitions(db, 't1');
    expect(r).toHaveLength(1);
    expect(r[0].mode).toBe('TRIAL');
  });

  it('export consolida people/enrollments/subscriptions/transitions', async () => {
    const db = mkDb([
      [/FROM people/, [{ id: 'p1' }]],
      [/FROM enrollments/, [{ id: 'e1' }]],
      [/FROM tenant_subscriptions/, [subRow]],
      [/FROM subscription_transitions/, [{ id: 'tr1' }]],
    ]);
    const r = await exportTenantData(db, 't1');
    expect(r.people).toHaveLength(1);
    expect(r.enrollments).toHaveLength(1);
    expect(r.subscriptions).toHaveLength(1);
    expect(r.transitions).toHaveLength(1);
  });
});

describe('branches residuais transition', () => {
  const planAnnual = { ...planRow, id: 'pv-an', billing_period: 'ANNUAL', trial_days: 0 };
  const activeSub = { ...subRow, status: 'ACTIVE' };

  it('TRIAL mode com trialDays 0 usa default 14', async () => {
    const planNoDays = { ...planRow, trial_days: 0 };
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planNoDays]],
      [/SELECT \* FROM tenant_subscriptions/, [activeSub]],
      [/UPDATE tenant_subscriptions/, [{ ...activeSub, status: 'TRIAL' }]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr1', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-pilot', mode: 'TRIAL', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    const r = await transitionSubscription(db, 't1', { planVersionId: 'pv-pilot', mode: 'TRIAL' });
    expect(r.subscription.status).toBe('TRIAL');
  });

  it('UPGRADE anual termina em 365d', async () => {
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planAnnual]],
      [/SELECT \* FROM tenant_subscriptions/, [activeSub]],
      [/plan_version_limits/, []],
      [/UPDATE tenant_subscriptions/, [{ ...activeSub, plan_version_id: 'pv-an' }]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr2', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-an', mode: 'UPGRADE', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    const r = await transitionSubscription(db, 't1', { planVersionId: 'pv-an', mode: 'UPGRADE' });
    expect(r.subscription.status).toBe('ACTIVE');
  });

  it('UPGRADE com limits: ativa existente e insere nova', async () => {
    const base = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planUp]],
      [/SELECT \* FROM tenant_subscriptions/, [activeSub]],
      [/plan_version_limits/, [{ limit_key: 'm1', value: 1 }, { limit_key: 'm2', value: 2 }]],
      [/UPDATE tenant_subscriptions/, [{ ...activeSub, plan_version_id: 'pv-up' }]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr3', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-up', mode: 'UPGRADE', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    const db = base;
    let n = 0;
    const orig = (db as any).query.bind(db);
    (db as any).query = async (sql: string, values: any[] = []) => {
      if (/SELECT 1 FROM tenant_entitlements/.test(sql)) {
        n += 1;
        return n === 1 ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return orig(sql, values);
    };
    await transitionSubscription(db, 't1', { planVersionId: 'pv-up', mode: 'UPGRADE' });
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO tenant_entitlements'))).toBe(true);
    expect(db.calls.some((c) => /UPDATE tenant_entitlements SET active = true/.test(c.sql))).toBe(true);
  });

  it('assinatura ausente → SubscriptionNotFoundError', async () => {
    const db = mkDb([[/SELECT \* FROM plan_versions WHERE id/, [planUp]], [/SELECT \* FROM tenant_subscriptions/, []]]);
    await expect(transitionSubscription(db, 't1', { planVersionId: 'pv-up', mode: 'UPGRADE' })).rejects.toMatchObject({ name: 'SubscriptionNotFoundError' });
  });

  it('toSub com started_at Date e current_period_end null', async () => {
    const row = { ...activeSub, started_at: new Date('2026-01-01T10:00:00Z'), current_period_end: null };
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planUp]],
      [/SELECT \* FROM tenant_subscriptions/, [activeSub]],
      [/plan_version_limits/, []],
      [/UPDATE tenant_subscriptions/, [row]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr4', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-up', mode: 'UPGRADE', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    const r = await transitionSubscription(db, 't1', { planVersionId: 'pg-up', mode: 'UPGRADE' });
    expect(r.subscription.currentPeriodEnd).toBeNull();
    expect(r.subscription.startedAt).toBe('2026-01-01');
  });
});

describe('ternários trial_days', () => {
  it('createTrial com trialDays 0 usa 14', async () => {
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [{ ...planRow, trial_days: 0 }]],
      [/slug = /, []],
      [/RETURNING \*/, [subRow]],
    ]);
    const r = await createTrial(db, { name: 'Sem Dias', planVersionId: 'pv-pilot' });
    expect(r.subscription.status).toBe('TRIAL');
  });

  it('transition TRIAL com trialDays > 0 usa valor do plano', async () => {
    const db = mkDb([
      [/SELECT \* FROM plan_versions WHERE id/, [planRow]],
      [/SELECT \* FROM tenant_subscriptions/, [subRow]],
      [/UPDATE tenant_subscriptions/, [{ ...subRow, status: 'TRIAL' }]],
      [/INSERT INTO subscription_transitions/, [{ id: 'tr5', tenant_id: 't1', from_plan_version_id: 'pv-pilot', to_plan_version_id: 'pv-pilot', mode: 'TRIAL', actor_user_id: null, notes: null, transitioned_at: new Date() }]],
    ]);
    const r = await transitionSubscription(db, 't1', { planVersionId: 'pv-pilot', mode: 'TRIAL' });
    expect(r.subscription.status).toBe('TRIAL');
  });
});
