/**
 * E06-06 E2E — comissões versionadas + metas (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let adminToken = '';
const H = () => ({ authorization: `Bearer ${token}` });

async function login(email: string, tenant: string, role = 'operator') {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), role],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function createEnrollmentWithSeller(): Promise<{ enrollmentId: string; totalCents: number }> {
  // lead → proposta accepted → convert → enrollment
  const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'Seller Lead', email: `comm-${Date.now()}@t.com`, source: 'website', consent: true } });
  const leadId = (lr.json() as { id: string }).id;
  const pir = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: `Curso ${Date.now()}`, durationMonths: 6, priceCents: 80000 } });
  const itemId = (pir.json() as { id: string }).id;
  const pr = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId } });
  const propId = (pr.json() as { id: string }).id;
  await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/approve`, headers: { authorization: `Bearer ${adminToken}` }, payload: {} });
  await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/send`, headers: H(), payload: {} });
  await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/accept`, headers: H(), payload: { signedByName: 'C' } });
  const conv = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/convert`, headers: H(), payload: {} });
  expect(conv.statusCode).toBe(201);
  const r = conv.json() as { enrollment: { id: string; offerId: string } };
  const item = await app.inject({ method: 'GET', url: '/v1/price-items', headers: H() });
  const total = (item.json() as Array<{ id: string; priceCents: number }>).find((x) => x.id === r.enrollment.offerId)?.priceCents ?? 80000;
  return { enrollmentId: r.enrollment.id, totalCents: total };
}

describe('E06-06 comissões', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0606@test.com', 'A');
    adminToken = await login('e0606-admin@test.com', 'A', 'admin');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ciclo: regra v1→v2, settle/reconcile→crédito, confirm, reversal, metas', async () => {
    // regra PERCENT 10%
    const r1 = await app.inject({ method: 'POST', url: '/v1/commission-rules', headers: H(), payload: { name: 'Padrão', kind: 'PERCENT', value: 10 } });
    expect(r1.statusCode).toBe(201);
    const rule1 = r1.json() as { id: string; version: number };
    expect(rule1.version).toBe(1);
    // v2 FLAT 3000 (supersede)
    const r2 = await app.inject({ method: 'POST', url: '/v1/commission-rules', headers: H(), payload: { name: 'Padrão', kind: 'FLAT', value: 3000 } });
    expect(r2.statusCode).toBe(201);
    expect((r2.json() as { version: number }).version).toBe(2);
    // lista ativa: só v2
    const list = await app.inject({ method: 'GET', url: '/v1/commission-rules?active=true', headers: H() });
    const active = list.json() as Array<{ name: string; version: number }>;
    expect(active.filter((x) => x.name === 'Padrão')).toHaveLength(1);
    expect(active.find((x) => x.name === 'Padrão')?.version).toBe(2);

    // matrícula com vendedor
    const { enrollmentId, totalCents } = await createEnrollmentWithSeller();
    // reconcile settle
    const rec1 = await app.inject({ method: 'POST', url: '/v1/commissions/reconcile', headers: H(), payload: { enrollmentId, userId: 'vendedor-1', baseCents: totalCents, sourceEvent: 'tuition.settled', sourceId: `s-${enrollmentId}` } });
    expect(rec1.statusCode).toBe(200);
    const { created } = rec1.json() as { created: Array<{ id: string; status: string; amountCents: number }> };
    expect(created).toHaveLength(1); // só v2 vigente
    expect(created[0]!.status).toBe('PENDING');
    const expected = Math.min(3000, totalCents); // FLAT cap
    expect(created[0]!.amountCents).toBe(expected);
    // retry idempotente
    const rec2 = await app.inject({ method: 'POST', url: '/v1/commissions/reconcile', headers: H(), payload: { enrollmentId, userId: 'vendedor-1', baseCents: totalCents, sourceEvent: 'tuition.settled', sourceId: `s-${enrollmentId}` } });
    expect((rec2.json() as { created: unknown[] }).created).toHaveLength(0);
    // confirm sem alçada (operator) → 422
    const conf1 = await app.inject({ method: 'POST', url: `/v1/commissions/${created[0]!.id}/confirm`, headers: H(), payload: {} });
    expect(conf1.statusCode).toBe(422);
    // confirm admin
    const conf2 = await app.inject({ method: 'POST', url: `/v1/commissions/${created[0]!.id}/confirm`, headers: { authorization: `Bearer ${adminToken}` }, payload: {} });
    expect(conf2.statusCode).toBe(200);
    expect((conf2.json() as { status: string }).status).toBe('CONFIRMED');
    // meta + progresso ANTES do reversal (R7 soma só CONFIRMED)
    const tgt = await app.inject({ method: 'PUT', url: '/v1/commissions/targets', headers: H(), payload: { userId: 'vendedor-1', period: '2026-11', amountCents: 10000 } });
    expect(tgt.statusCode).toBe(200);
    const prog = await app.inject({ method: 'GET', url: '/v1/commissions/targets/2026-11', headers: H() });
    const p = prog.json() as Array<{ userId: string; confirmedCents: number; progressPct: number }>;
    expect(p.find((x) => x.userId === 'vendedor-1')!.confirmedCents).toBe(expected);
    // reversal → REVERSED; progresso pós-reversal volta a 0 (só CONFIRMED conta)
    const rec3 = await app.inject({ method: 'POST', url: '/v1/commissions/reconcile', headers: H(), payload: { enrollmentId, userId: 'vendedor-1', baseCents: totalCents, sourceEvent: 'ledger.reversal', sourceId: `r-${enrollmentId}`, reversal: true } });
    const { reversed } = rec3.json() as { reversed: Array<{ status: string }> };
    expect(reversed).toHaveLength(1);
    expect(reversed[0]!.status).toBe('REVERSED');
    const prog2 = await app.inject({ method: 'GET', url: '/v1/commissions/targets/2026-11', headers: H() });
    expect((prog2.json() as Array<{ userId: string; confirmedCents: number }>).find((x) => x.userId === 'vendedor-1')?.confirmedCents).toBe(0);
  });

  it('cross-tenant: regra de A invisível p/ B (404 na reconcile de matrícula de B)', async () => {
    const tkB = await login('e0606-b@test.com', 'B');
    const recB = await app.inject({ method: 'POST', url: '/v1/commissions/reconcile', headers: { authorization: `Bearer ${tkB}` }, payload: { enrollmentId: 'zzz', userId: 'v', baseCents: 1000, sourceEvent: 'tuition.settled', sourceId: 's' } });
    expect(recB.statusCode).toBe(404);
  });
});
