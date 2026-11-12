/**
 * E13-04 E2E — trials e transições seguras (Postgres real):
 * criação de trial, guardas, ciclo UPGRADE→DOWNGRADE→CANCEL, trilha e export.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let opToken = '';
let tenantId = '';

async function login(email: string, tenant: string, role: 'admin' | 'operator' = 'operator') {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), role],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

describe('E13-04 trials e transições', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantId = t.rows[0]!.id as string;
    adminToken = await login('e1304-admin@test.com', tenantId, 'admin');
    opToken = await login('e1304-op@test.com', tenantId);
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('TRIAL: cria tenant + assinatura TRIAL com datas coerentes', async () => {
    const H = () => ({ authorization: `Bearer ${adminToken}` });
    const pilot = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'e1304-pilot', name: 'E1304 Pilot', planType: 'PILOT', billingPeriod: 'MONTHLY', unitPriceCents: 0, trialDays: 14,
    } });
    expect(pilot.statusCode).toBe(201);
    const pilotId = (pilot.json() as { id: string }).id;
    expect((await app.inject({ method: 'POST', url: `/v1/plan-versions/${pilotId}/publish`, headers: H() })).statusCode).toBe(200);

    const trial = await app.inject({ method: 'POST', url: '/v1/trials', headers: H(), payload: { name: 'Escola Trial E1304', planVersionId: pilotId } });
    if (trial.statusCode !== 201) console.error('TRIAL_FAIL', trial.statusCode, trial.body);
    expect(trial.statusCode).toBe(201);
    const body = trial.json() as { tenant: { id: string; slug: string }; subscription: { status: string; currentPeriodEnd: string } };
    expect(body.subscription.status).toBe('TRIAL');
    expect(body.tenant.slug).toBe('escola-trial-e1304');
    const end = new Date(body.subscription.currentPeriodEnd).getTime();
    const in14d = Date.now() + 13 * 864e5;
    expect(end).toBeGreaterThan(Date.now());
    expect(end).toBeLessThan(in14d + 2 * 864e5);

    // slug duplicado → 422
    const dup = await app.inject({ method: 'POST', url: '/v1/trials', headers: H(), payload: { name: 'Escola Trial E1304', planVersionId: pilotId } });
    expect(dup.statusCode).toBe(422);
  }, 60_000);

  it('guardas: operator 403; plano não-PILOT 422; uuid inválido 400', async () => {
    const H = () => ({ authorization: `Bearer ${adminToken}` });
    const std = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: { key: 'e1304-std', name: 'Std', planType: 'STANDARD', billingPeriod: 'MONTHLY', unitPriceCents: 100 } });
    const stdId = (std.json() as { id: string }).id;
    const forbidden = await app.inject({ method: 'POST', url: '/v1/trials', headers: { authorization: `Bearer ${opToken}` }, payload: { name: 'X Y', planVersionId: stdId } });
    expect(forbidden.statusCode).toBe(403);
    const wrong = await app.inject({ method: 'POST', url: '/v1/trials', headers: H(), payload: { name: 'X Y', planVersionId: stdId } });
    expect(wrong.statusCode).toBe(422);
    const bad = await app.inject({ method: 'POST', url: '/v1/trials', headers: H(), payload: { name: 'X Y', planVersionId: 'nope' } });
    expect(bad.statusCode).toBe(400);
  }, 60_000);

  it('ciclo UPGRADE → DOWNGRADE (grace) → CANCEL → trilha + export', async () => {
    const H = () => ({ authorization: `Bearer ${adminToken}` });
    const mk = async (key: string) => {
      const r = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: { key, name: key, planType: 'STANDARD', billingPeriod: 'MONTHLY', unitPriceCents: 100 } });
      const id = (r.json() as { id: string }).id;
      await app.inject({ method: 'POST', url: `/v1/plan-versions/${id}/publish`, headers: H() });
      return id;
    };
    const planA = await mk('e1304-a');
    const planB = await mk('e1304-b');

    const sub = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/subscription`, headers: H(), payload: { planVersionId: planA, status: 'ACTIVE' } });
    expect([200, 201]).toContain(sub.statusCode);

    const up = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/subscription/transition`, headers: H(), payload: { planVersionId: planB, mode: 'UPGRADE' } });
    if (up.statusCode !== 200) console.error('UP_FAIL', up.statusCode, up.body);
    expect(up.statusCode).toBe(200);
    expect((up.json() as { subscription: { status: string } }).subscription.status).toBe('ACTIVE');

    const down = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/subscription/transition`, headers: H(), payload: { planVersionId: planA, mode: 'DOWNGRADE' } });
    if (down.statusCode !== 200) console.error('DOWN_FAIL', down.statusCode, down.body);
    expect(down.statusCode).toBe(200);

    const tr = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/subscription/transitions`, headers: H() });
    expect(tr.statusCode).toBe(200);
    const modes = ((tr.json() as { transitions: Array<{ mode: string }> }).transitions).map((x) => x.mode);
    expect(modes).toContain('UPGRADE');
    expect(modes).toContain('DOWNGRADE');

    const cancel = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/subscription/transition`, headers: H(), payload: { planVersionId: planA, mode: 'CANCEL' } });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { subscription: { status: string } }).subscription.status).toBe('CANCELED');

    const exp = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/export`, headers: H() });
    expect(exp.statusCode).toBe(200);
    const data = exp.json() as { transitions: unknown[]; subscriptions: unknown[] };
    expect(Array.isArray(data.transitions)).toBe(true);
    expect(Array.isArray(data.subscriptions)).toBe(true);
  }, 60_000);
});
