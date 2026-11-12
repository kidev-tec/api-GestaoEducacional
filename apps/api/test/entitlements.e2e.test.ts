/**
 * E13-02 E2E — entitlements: grant, seats, revoke, audit, isolation (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });
let tenantA = '';

async function login(email: string, tenant: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

describe('E13-02 entitlements', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantA = t.rows[0]!.id as string;
    token = await login('e1302@test.com', tenantA);
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ISOL: tenant sem entitlements vê lista vazia', async () => {
    const t2 = await db.pool.query('INSERT INTO tenants (id) VALUES ($1) RETURNING id', [crypto.randomUUID()]);
    const t2id = t2.rows[0]!.id as string;
    const tok2 = await login('iso1302@test.com', t2id);
    const list = await app.inject({ method: 'GET', url: '/v1/entitlements', headers: { authorization: `Bearer ${tok2}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(0);
  });

  it('grant com dependências; seats; revoke; audit; 422/404', async () => {
    // core primeiro, depois secretaria, depois crm (dependências encadeadas)
    const gCore = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'core' } });
    if (gCore.statusCode !== 201) console.error('CORE_FAIL', gCore.statusCode, gCore.body);
    expect(gCore.statusCode).toBe(201);
    const gSec = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'secretaria', seats: 10 } });
    expect(gSec.statusCode).toBe(201);
    // crm antes das deps ok? secretaria já concedida ✓
    const gCrm = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'crm', seats: 5, note: 'contrato inicial' } });
    if (gCrm.statusCode !== 201) console.error('CRM_FAIL', gCrm.statusCode, gCrm.body);
    expect(gCrm.statusCode).toBe(201);
    // dependência ausente: bi requer core ✓ (concedido), mas 'ia' requer bi (não concedido) → 422
    const gIa = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'ia' } });
    expect(gIa.statusCode).toBe(422);
    // período inválido → 422
    const badPeriod = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'bi', startsAt: '2026-12-01', endsAt: '2026-01-01' } });
    expect(badPeriod.statusCode).toBe(422);
    // lista com 3
    const list = await app.inject({ method: 'GET', url: '/v1/entitlements', headers: H() });
    expect((list.json() as unknown[]).length).toBe(3);
    // seats down permitido
    const seatsDown = await app.inject({ method: 'PATCH', url: '/v1/entitlements/crm', headers: H(), payload: { seats: 2 } });
    expect(seatsDown.statusCode).toBe(200);
    expect((seatsDown.json() as { seats: number }).seats).toBe(2);
    // revoke
    const rv = await app.inject({ method: 'PATCH', url: '/v1/entitlements/crm', headers: H(), payload: { active: false } });
    expect(rv.statusCode).toBe(200);
    expect((rv.json() as { active: boolean }).active).toBe(false);
    // audit do crm tem GRANTED, SEATS_CHANGED, REVOKED
    const au = await app.inject({ method: 'GET', url: '/v1/entitlements/crm/audit', headers: H() });
    const actions = (au.json() as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('GRANTED');
    expect(actions).toContain('SEATS_CHANGED');
    expect(actions).toContain('REVOKED');
    // reativar via POST (idempotente)
    const re = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'crm', seats: 7 } });
    expect(re.statusCode).toBe(201);
    // módulo inexistente → 404
    const nf = await app.inject({ method: 'POST', url: '/v1/entitlements', headers: H(), payload: { moduleKey: 'zz' } });
    expect(nf.statusCode).toBe(404);
    // patch inexistente → 404
    const pnf = await app.inject({ method: 'PATCH', url: '/v1/entitlements/zz', headers: H(), payload: { seats: 2 } });
    expect(pnf.statusCode).toBe(404);
  });
});
