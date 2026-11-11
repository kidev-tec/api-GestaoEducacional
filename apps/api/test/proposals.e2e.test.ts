/**
 * E06-04 E2E — propostas + price books versionados (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
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

describe('E06-04 propostas', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0604@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('cria price item + ciclo completo draft→pending→approve→send→accept com snapshot', async () => {
    // lead p/ proposta
    const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email: 'e0604-l1@test.com', source: 'website', consent: true } });
    const leadId = (lr.json() as { id: string }).id;
    // price item
    const pir = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: 'Inglês 12m', durationMonths: 12, priceCents: 100000 } });
    expect(pir.statusCode).toBe(201);
    const itemId = (pir.json() as { id: string }).id;
    // lista vigentes
    const list = await app.inject({ method: 'GET', url: '/v1/price-items', headers: H() });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string }>).some((x) => x.id === itemId)).toBe(true);
    // simulate 20% → alçada
    const sim = await app.inject({ method: 'POST', url: '/v1/proposals/simulate', headers: H(), payload: { priceCents: 100000, discountCents: 20000 } });
    expect(sim.statusCode).toBe(200);
    const simJ = sim.json() as { needsApproval: boolean; totalCents: number };
    expect(simJ.needsApproval).toBe(true);
    expect(simJ.totalCents).toBe(80000);
    // cria proposta com 20% → pending_approval
    const pr = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId, discountCents: 20000 } });
    expect(pr.statusCode).toBe(201);
    const prop = pr.json() as { id: string; status: string; totalCents: number };
    expect(prop.status).toBe('pending_approval');
    // criador não pode aprovar (mesmo user)
    const selfApprove = await app.inject({ method: 'POST', url: `/v1/proposals/${prop.id}/approve`, headers: H(), payload: {} });
    expect(selfApprove.statusCode).toBe(422);
    // outro user aprova
    const token2 = await login('e0604-apr@test.com', 'A');
    const apr = await app.inject({ method: 'POST', url: `/v1/proposals/${prop.id}/approve`, headers: { authorization: `Bearer ${token2}` }, payload: {} });
    expect(apr.statusCode).toBe(200);
    expect((apr.json() as { status: string }).status).toBe('approved');
    // send → accept
    await app.inject({ method: 'POST', url: `/v1/proposals/${prop.id}/send`, headers: H(), payload: {} });
    const acc = await app.inject({ method: 'POST', url: `/v1/proposals/${prop.id}/accept`, headers: H(), payload: { signedByName: 'Cliente Teste' } });
    expect(acc.statusCode).toBe(200);
    const accepted = acc.json() as { status: string; signedAt: string; totalCents: number };
    expect(accepted.status).toBe('accepted');
    expect(accepted.signedAt).toBeTruthy();
    expect(accepted.totalCents).toBe(80000); // snapshot congelado
    // eventos completos na timeline
    const detail = await app.inject({ method: 'GET', url: `/v1/proposals/${prop.id}`, headers: H() });
    expect(detail.statusCode).toBe(200);
    const events = (detail.json() as { events: Array<{ action: string }> }).events.map((e) => e.action);
    expect(events).toEqual(['created', 'approved', 'sent', 'accepted']);
    // proposta aceita é terminal: reject bloqueia
    const rej = await app.inject({ method: 'POST', url: `/v1/proposals/${prop.id}/reject`, headers: H(), payload: {} });
    expect(rej.statusCode).toBe(422);
  });

  it('R4: desconto >30% bloqueia 422; versionamento de preço preserva proposta assinada; cross-tenant 404', async () => {
    const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L2', email: 'e0604-l2@test.com', source: 'website', consent: true } });
    const leadId = (lr.json() as { id: string }).id;
    const pir = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: 'Espanhol 6m', durationMonths: 6, priceCents: 50000 } });
    const itemId = (pir.json() as { id: string }).id;
    // 31% → 422
    const over = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId, discountCents: 15500 } });
    expect(over.statusCode).toBe(422);
    // assina proposta com preço atual
    const pr = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: itemId } });
    const p1 = pr.json() as { id: string };
    const token2 = await login('e0604-apr2@test.com', 'A');
    const ap2 = await app.inject({ method: 'POST', url: `/v1/proposals/${p1.id}/approve`, headers: { authorization: `Bearer ${token2}` }, payload: {} });
    await app.inject({ method: 'POST', url: `/v1/proposals/${p1.id}/send`, headers: H(), payload: {} });
    const acc = await app.inject({ method: 'POST', url: `/v1/proposals/${p1.id}/accept`, headers: H(), payload: { signedByName: 'Cliente 2' } });
    expect(acc.statusCode).toBe(200);
    // agora supersede o preço: novo item v2, v1 fecha
    const sup = await app.inject({ method: 'POST', url: '/v1/price-items', headers: H(), payload: { courseName: 'Espanhol 6m', durationMonths: 6, priceCents: 60000, supersedeId: itemId } });
    expect(sup.statusCode).toBe(201);
    const v2 = sup.json() as { id: string; version: number };
    expect(v2.version).toBe(2);
    // proposta assinada continua com total antigo (snapshot imutável)
    const detail = await app.inject({ method: 'GET', url: `/v1/proposals/${p1.id}`, headers: H() });
    expect((detail.json() as { proposal: { totalCents: number; priceItemId: string } }).proposal.totalCents).toBe(50000);
    // item antigo não aparece mais nos vigentes
    const list = await app.inject({ method: 'GET', url: '/v1/price-items', headers: H() });
    const ids = (list.json() as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain(itemId);
    expect(ids).toContain(v2.id);
    // cross-tenant: proposta de A invisível p/ B
    const tkB = await login('e0604-b@test.com', 'B');
    const bView = await app.inject({ method: 'GET', url: `/v1/proposals/${p1.id}`, headers: { authorization: `Bearer ${tkB}` } });
    expect(bView.statusCode).toBe(404);
    // aprovação sem alçada (viewer) → 422
    const tkV = await login('e0604-v@test.com', 'A', 'viewer');
    const pr3 = await app.inject({ method: 'POST', url: '/v1/proposals', headers: H(), payload: { leadId, priceItemId: v2.id, discountCents: 6000 } }); // 12% → draft
    const p3 = pr3.json() as { id: string; status: string };
    // draft→approved permitido pela máquina, mas role viewer bloqueado pelo writeGuard (403)
    const noAlc = await app.inject({ method: 'POST', url: `/v1/proposals/${p3.id}/approve`, headers: { authorization: `Bearer ${tkV}` }, payload: {} });
    expect(noAlc.statusCode).toBe(403);
  });
});
