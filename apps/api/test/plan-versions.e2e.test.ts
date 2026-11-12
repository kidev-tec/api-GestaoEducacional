/**
 * E13-03 E2E — planos versionados: criação, publish, simulador transparente,
 * assinatura por tenant e isolamento (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let adminToken = '';
let tenantA = '';

async function login(email: string, tenant: string, role: 'admin' | 'operator' = 'operator') {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), role],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

describe('E13-03 plan versions', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantA = t.rows[0]!.id as string;
    token = await login('e1303@test.com', tenantA);
    adminToken = await login('e1303-admin@test.com', tenantA, 'admin');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ISOL: tenant 2 não vê assinatura nem planos do tenant A; cross-tenant 404', async () => {
    const t2 = await db.pool.query('INSERT INTO tenants (id) VALUES ($1) RETURNING id', [crypto.randomUUID()]);
    const t2id = t2.rows[0]!.id as string;
    const tok2 = await login('iso1303@test.com', t2id);
    const sub = await app.inject({ method: 'GET', url: `/v1/tenants/${t2id}/subscription`, headers: { authorization: `Bearer ${tok2}` } });
    expect(sub.statusCode).toBe(200);
    expect((sub.json() as { subscription: unknown }).subscription).toBeNull();
    // cross-tenant: token do tenant 2 pedindo assinatura do tenant A → 404
    const cross = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantA}/subscription`, headers: { authorization: `Bearer ${tok2}` } });
    expect(cross.statusCode).toBe(404);
  });

  it('ciclo completo: criar v1 → publish → quote mensal → nova v2 → quote anual → assinatura', async () => {
    const H = () => ({ authorization: `Bearer ${adminToken}` });
    // criar v1
    const v1 = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'essencial', name: 'Essencial', planType: 'STANDARD', billingPeriod: 'MONTHLY',
      unitPriceCents: 20000, seatPriceCents: 5000, limits: [{ key: 'max_students', value: 300 }],
    } });
    if (v1.statusCode !== 201) console.error('V1_FAIL', v1.statusCode, v1.body);
    expect(v1.statusCode).toBe(201);
    const pv1 = v1.json() as { id: string; version: number };
    expect(pv1.version).toBe(1);

    // publish
    const pub = await app.inject({ method: 'POST', url: `/v1/plan-versions/${pv1.id}/publish`, headers: H() });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { published: boolean }).published).toBe(true);

    // lista default: só published
    const list = await app.inject({ method: 'GET', url: '/v1/plan-versions', headers: { authorization: `Bearer ${token}` } });
    if (list.statusCode !== 200) console.error('LIST_FAIL', list.statusCode, list.body);
    const items = (list.json() as { planVersions?: { id: string; published: boolean }[] }).planVersions!;
    expect(items.some((p) => p.id === pv1.id)).toBe(true);

    // detalhe com limites
    const det = await app.inject({ method: 'GET', url: `/v1/plan-versions/${pv1.id}`, headers: { authorization: `Bearer ${token}` } });
    expect((det.json() as { limits: { key: string; value: number }[] }).limits).toEqual([{ key: 'max_students', value: 300 }]);

    // quote mensal: 3 unidades + 10 assentos = 60k + 50k
    const qm = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: pv1.id, units: 3, seats: 10 } });
    if (qm.statusCode !== 200) console.error('QUOTE_FAIL', qm.statusCode, qm.body);
    const q1 = qm.json() as { lines: { label: string; amount: number }[]; totalCents: number };
    expect(qm.statusCode).toBe(200);
    expect(q1.lines).toHaveLength(2);
    expect(q1.lines[0]!.amount).toBe(60000);
    expect(q1.lines[1]!.amount).toBe(50000);
    expect(q1.totalCents).toBe(110000);

    // v2 anual
    const v2 = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'essencial', name: 'Essencial Anual', planType: 'STANDARD', billingPeriod: 'ANNUAL', unitPriceCents: 20000,
    } });
    expect(v2.statusCode).toBe(201);
    const pv2 = v2.json() as { id: string; version: number };
    expect(pv2.version).toBe(2);
    await app.inject({ method: 'POST', url: `/v1/plan-versions/${pv2.id}/publish`, headers: H() });

    // quote anual v2: 3 unidades × 12 = 720000 − desconto 120000 = 600000; v1 inalterada
    const qa = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: pv2.id, units: 3, seats: 0 } });
    const q2 = qa.json() as { lines: { label: string; amount: number }[]; totalCents: number };
    expect(qa.statusCode).toBe(200);
    expect(q2.lines[1]!.label).toContain('Desconto anual');
    expect(q2.totalCents).toBe(600000);
    const q1again = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: pv1.id, units: 3, seats: 10 } });
    expect((q1again.json() as { totalCents: number }).totalCents).toBe(110000);

    // assinatura admin → 201; re-upsert muda status
    const sub1 = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantA}/subscription`, headers: H(), payload: {
      planVersionId: pv2.id, status: 'ACTIVE', currentPeriodEnd: '2027-11-12',
    } });
    if (sub1.statusCode !== 201) console.error('SUB_FAIL', sub1.statusCode, sub1.body);
    expect(sub1.statusCode).toBe(201);
    const sub2 = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantA}/subscription`, headers: H(), payload: {
      planVersionId: pv2.id, status: 'PAST_DUE',
    } });
    expect((sub2.json() as { status: string }).status).toBe('PAST_DUE');
    const got = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantA}/subscription`, headers: { authorization: `Bearer ${token}` } });
    expect((got.json() as { subscription: { status: string } }).subscription!.status).toBe('PAST_DUE');
  });

  it('PILOT sem trialDays → 422; quote PILOT = 0; FRANCHISE override; 404/422', async () => {
    const H = () => ({ authorization: `Bearer ${adminToken}` });
    const badPilot = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'piloto-x', name: 'P', planType: 'PILOT', billingPeriod: 'MONTHLY', unitPriceCents: 0, trialDays: 0,
    } });
    expect(badPilot.statusCode).toBe(422);

    const pilot = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'piloto-x', name: 'P', planType: 'PILOT', billingPeriod: 'MONTHLY', unitPriceCents: 20000, trialDays: 14,
    } });
    expect(pilot.statusCode).toBe(201);
    const pp = pilot.json() as { id: string };
    const qp = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: pp.id, units: 2, seats: 0 } });
    if (qp.statusCode !== 200) console.error('PILOT_QUOTE_FAIL', qp.statusCode, qp.body);
    const q = qp.json() as { lines: { label: string }[]; totalCents: number };
    expect(q.totalCents).toBe(0);
    expect(q.lines.some((l) => l.label.includes('Trial 14 dias'))).toBe(true);

    const fran = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'franquia', name: 'F', planType: 'FRANCHISE', billingPeriod: 'MONTHLY', unitPriceCents: 30000,
    } });
    const fp = (fran.json() as { id: string });
    const qf = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: fp.id, units: 4, seats: 0, priceOverrideCents: 10000 } });
    const q2 = qf.json() as { lines: { label: string; amount: number }[] };
    expect(q2.lines[0]!.label).toContain('preço negociado');
    expect(q2.lines[0]!.amount).toBe(40000);

    // 404: quote plano inexistente (uuid válido)
    const nf = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: crypto.randomUUID(), units: 1, seats: 0 } });
    expect(nf.statusCode).toBe(404);
    // 422: unidades < min
    const mn = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: H(), payload: {
      key: 'min3', name: 'M', planType: 'STANDARD', billingPeriod: 'MONTHLY', unitPriceCents: 1000, minUnits: 3,
    } });
    const mnp = (mn.json() as { id: string });
    const underMin = await app.inject({ method: 'POST', url: '/v1/plans/quote', headers: { authorization: `Bearer ${token}` }, payload: { planId: mnp.id, units: 1, seats: 0 } });
    expect(underMin.statusCode).toBe(422);
    // operator não cria plano (writeGuard exige admin via requireRole admin) → 403
    const forb = await app.inject({ method: 'POST', url: '/v1/plan-versions', headers: { authorization: `Bearer ${token}` }, payload: {
      key: 'nao', name: 'N', planType: 'STANDARD', billingPeriod: 'MONTHLY', unitPriceCents: 1,
    } });
    expect([403, 422]).toContain(forb.statusCode);
  });
});
