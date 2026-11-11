/**
 * E06-05 E2E — accept→convert→matrícula (Postgres real, idempotência por retry).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });

async function login(email: string, tenant: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function acceptedProposal(leadEmail: string): Promise<{ propId: string }> {
  const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'Lead Conv', email: leadEmail, source: 'website', consent: true } });
  const leadId = (lr.json() as { id: string }).id;
  const pir = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: 'Curso Conv', durationMonths: 6, priceCents: 80000 } });
  const itemId = (pir.json() as { id: string }).id;
  const pr = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId, discountCents: 0 } });
  const propId = (pr.json() as { id: string }).id;
  const tk2 = await login(`apr-${leadEmail}`, 'A');
  await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/approve`, headers: { authorization: `Bearer ${tk2}` }, payload: {} });
  await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/send`, headers: H(), payload: {} });
  const acc = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/accept`, headers: H(), payload: { signedByName: 'Cliente' } });
  expect(acc.statusCode).toBe(200);
  return { propId };
}

describe('E06-05 conversão', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0605@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('C1: proposta não-accepted → 422', async () => {
    const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email: 'e0605-c1@test.com', source: 'website', consent: true } });
    const leadId = (lr.json() as { id: string }).id;
    const pir = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: 'C1', durationMonths: 1, priceCents: 10000 } });
    const itemId = (pir.json() as { id: string }).id;
    const pr = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId } }); // draft
    const propId = (pr.json() as { id: string }).id;
    const conv = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/convert`, headers: H(), payload: {} });
    expect(conv.statusCode).toBe(422);
  });

  it('C2–C5: accept→convert→DRAFT com offer=price_item; retry → replay mesma matrícula; outbox persistido; trilha converted', async () => {
    const { propId } = await acceptedProposal('e0605-main@test.com');
    const conv1 = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/convert`, headers: H(), payload: {} });
    if (conv1.statusCode !== 201) console.error('CONV1_FAIL', conv1.body);
    expect(conv1.statusCode).toBe(201);
    const r1 = conv1.json() as { enrollment: { id: string; state: string; offerId: string; studentId: string }; idempotentReplay: boolean };
    expect(r1.idempotentReplay).toBe(false);
    expect(r1.enrollment.state).toBe('DRAFT');
    expect(r1.enrollment.offerId).toBeTruthy();
    expect(r1.enrollment.studentId).toBeTruthy();
    // retry → mesma matrícula
    const conv2 = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/convert`, headers: H(), payload: {} });
    expect(conv2.statusCode).toBe(200);
    const r2 = conv2.json() as { enrollment: { id: string }; idempotentReplay: boolean };
    expect(r2.idempotentReplay).toBe(true);
    expect(r2.enrollment.id).toBe(r1.enrollment.id);
    // outbox: exatamente 1 evento enrollment.created p/ proposta
    const ev = await db.pool.query(
      "SELECT payload FROM outbox_events WHERE tenant_id = 'A' AND type = 'enrollment.created' AND payload->>'proposalId' = $1",
      [propId],
    );
    expect(ev.rowCount).toBe(1);
    const payload = (ev.rows[0] as { payload: { totalCents: number; enrollmentId: string } }).payload;
    expect(payload.enrollmentId).toBe(r1.enrollment.id);
    // trilha converted no GET
    const detail = await app.inject({ method: 'GET', url: `/v1/proposals/${propId}`, headers: H() });
    const actions = (detail.json() as { events: Array<{ action: string }> }).events.map((e) => e.action);
    expect(actions).toContain('converted');
  });

  it('C6: cross-tenant 404 na conversão', async () => {
    const { propId } = await acceptedProposal('e0605-xt@test.com');
    const tkB = await login('e0605-b@test.com', 'B');
    const convB = await app.inject({ method: 'POST', url: `/v1/proposals/${propId}/convert`, headers: { authorization: `Bearer ${tkB}` }, payload: {} });
    expect(convB.statusCode).toBe(404);
  });
});
