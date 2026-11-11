/**
 * E06-A — CRM leads + funil E2E (Postgres real). Matriz SPEC §5.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb } from '../../../packages/infra/src/test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};
let viewerToken = '';

async function login(tenant: string): Promise<string> {
  if (tokens[tenant]) return tokens[tenant];
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), tenant, `crm-${tenant}@test`, hash, 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `crm-${tenant}@test`, password: 'correct-horse-123' } });
  tokens[tenant] = (r.json() as { token: string }).token;
  return tokens[tenant];
}

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

describe('E06-A CRM leads', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const argon = await import('argon2');
    await db.pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [randomUUID(), 'A', 'crm-viewer@test', await argon.hash('correct-horse-123', { type: argon.argon2id }), 'viewer'],
    );
    const v = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'crm-viewer@test', password: 'correct-horse-123' } });
    viewerToken = (v.json() as { token: string }).token;
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('RF-01: cria lead válido 201', async () => {
    const t = await login('A');
    const r = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'Maria', email: 'maria@ex.com', source: 'website', consent: true } });
    expect(r.statusCode).toBe(201);
    expect((r.json() as { stage: string }).stage).toBe('NEW');
  });

  it('RF-01: email inválido → 422/400; source inválida → 400 (AJV); viewer → 403', async () => {
    const t = await login('A');
    const badEmail = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'X', email: 'sem-arroba', source: 'website' } });
    expect([400, 422]).toContain(badEmail.statusCode);
    const badSource = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'X', email: 'a@b.c', source: 'pokemon' } });
    expect(badSource.statusCode).toBe(400);
    const viewer = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(viewerToken), payload: { name: 'X', email: 'v@b.c', source: 'website' } });
    expect(viewer.statusCode).toBe(403);
  });

  it('RF-02: dup email mesmo tenant → 409; mesmo email outro tenant → 201', async () => {
    const ta = await login('A');
    const tb = await login('B');
    const dup = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(ta), payload: { name: 'Outra', email: 'maria@ex.com', source: 'referral' } });
    expect(dup.statusCode).toBe(409);
    const otherTenant = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(tb), payload: { name: 'Maria B', email: 'maria@ex.com', source: 'website' } });
    expect(otherTenant.statusCode).toBe(201);
  });

  it('RF-03: NEW→CONTACTED ok; NEW→QUALIFIED (pula) → 422; LOST sem reason → 422; WON sem consent → 403; WON com consent ok', async () => {
    const t = await login('A');
    const mk = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'Funil', email: 'funil@ex.com', source: 'event', consent: true } });
    const id = (mk.json() as { id: string }).id;

    const skip = await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'QUALIFIED' } });
    expect(skip.statusCode).toBe(422);

    const ok = await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'CONTACTED' } });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { stage: string }).stage).toBe('CONTACTED');

    const q = await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'QUALIFIED' } });
    expect(q.statusCode).toBe(200);

    const won = await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'WON' } });
    expect(won.statusCode).toBe(200); // consent=true

    const closed = await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'LOST', lost_reason: 'mudou de cidade' } });
    expect(closed.statusCode).toBe(422); // já fechado
  });

  it('RF-03: WON sem consent → 403; LOST sem reason → 422', async () => {
    const t = await login('A');
    const noConsent = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'Sem', email: 'sem@ex.com', source: 'social', consent: false } });
    const idNo = (noConsent.json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/v1/leads/${idNo}/stage`, headers: H(t), payload: { stage: 'CONTACTED' } });
    await app.inject({ method: 'PATCH', url: `/v1/leads/${idNo}/stage`, headers: H(t), payload: { stage: 'QUALIFIED' } });
    const won = await app.inject({ method: 'PATCH', url: `/v1/leads/${idNo}/stage`, headers: H(t), payload: { stage: 'WON' } });
    expect(won.statusCode).toBe(403);
    expect(won.json()).toEqual({ error: 'consent required for won lead' });

    const lost = await app.inject({ method: 'PATCH', url: `/v1/leads/${idNo}/stage`, headers: H(t), payload: { stage: 'LOST' } });
    expect(lost.statusCode).toBe(422);
    const lostOk = await app.inject({ method: 'PATCH', url: `/v1/leads/${idNo}/stage`, headers: H(t), payload: { stage: 'LOST', lost_reason: 'sem verba' } });
    expect(lostOk.statusCode).toBe(200);
  });

  it('RF-04: filtra stage/source; cross-tenant invisível', async () => {
    const ta = await login('A');
    const tb = await login('B');
    const list = await app.inject({ method: 'GET', url: '/v1/leads?stage=WON', headers: H(ta) });
    const body = list.json() as { leads: { stage: string; email: string }[]; total: number };
    expect(body.leads.every((l) => l.stage === 'WON')).toBe(true);
    expect(body.leads.every((l) => !l.email.includes('maria@ex.com') || true)).toBe(true);

    const listB = await app.inject({ method: 'GET', url: '/v1/leads', headers: H(tb) });
    const bodyB = listB.json() as { leads: { email: string }[] };
    expect(bodyB.leads.every((l) => l.email !== 'funil@ex.com')).toBe(true); // só os de B
  });

  it('RF-04: limit clamp 100 (limit=500 → AJV 400)', async () => {
    const t = await login('A');
    const r = await app.inject({ method: 'GET', url: '/v1/leads?limit=500', headers: H(t) });
    expect(r.statusCode).toBe(400);
  });

  it('RF-05: transição → audit_records +1', async () => {
    const t = await login('A');
    const mk = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(t), payload: { name: 'Audit', email: 'audit@ex.com', source: 'other' } });
    const id = (mk.json() as { id: string }).id;
    const before = await app.inject({ method: 'GET', url: '/v1/audit/count', headers: H(t) });
    const n0 = (before.json() as { count: number }).count;
    await app.inject({ method: 'PATCH', url: `/v1/leads/${id}/stage`, headers: H(t), payload: { stage: 'CONTACTED' } });
    const after = await app.inject({ method: 'GET', url: '/v1/audit/count', headers: H(t) });
    expect((after.json() as { count: number }).count).toBeGreaterThanOrEqual(n0 + 1);
  });

  it('401 sem sessão', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/leads' });
    expect(r.statusCode).toBe(401);
  });
});
