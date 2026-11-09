import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { buildApp, resetLoginLimiter } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
const password = 'correct-horse-123';
let adminToken = '';
let operatorToken = '';
let viewerToken = '';

async function login(email: string, pass = password) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: pass } });
}

/** Seed direto no banco (registro via API é admin-only; bootstrap precisa de SQL). */
async function seedUser(email: string, role: 'admin' | 'operator' | 'viewer', tenantId = 'A'): Promise<string> {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const id = randomUUID();
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [id, tenantId, email, hash, role],
  );
  const loginRes = await login(email);
  expect(loginRes.statusCode).toBe(200);
  return (loginRes.json() as { token: string }).token;
}

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
  adminToken = await seedUser('root@example.test', 'admin');
  operatorToken = await seedUser('ops@example.test', 'operator');
  viewerToken = await seedUser('ada@example.test', 'viewer');
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

describe('E04-A auth', () => {
  it('bootstrap: seeded users have argon2id hash and no plaintext', async () => {
    const stored = await db.pool.query('SELECT password_hash, role FROM users WHERE email = $1', ['ada@example.test']);
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0].password_hash).not.toContain(password);
    expect(stored.rows[0].role).toBe('viewer');
  });

  it('register is ADMIN-ONLY: anonymous cannot self-register, viewer/operator get 403, admin creates operator', async () => {
    const anonymous = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'self@test', password } });
    expect(anonymous.statusCode).toBe(401);
    const viewer = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { authorization: `Bearer ${viewerToken}` }, payload: { email: 'by-viewer@test', password } });
    expect(viewer.statusCode).toBe(403);
    const operator = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { authorization: `Bearer ${operatorToken}` }, payload: { email: 'by-ops@test', password } });
    expect(operator.statusCode).toBe(403);
    const admin = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: 'by-admin@test', password, role: 'operator' } });
    expect(admin.statusCode).toBe(201);
    const role = await db.pool.query('SELECT role FROM users WHERE email = $1', ['by-admin@test']);
    expect(role.rows[0].role).toBe('operator');
    const weak = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: 'weak@test', password: 'short' } });
    expect(weak.statusCode).toBe(400);
  });

  it('login issues opaque session and email is case-insensitive (citext)', async () => {
    const result = await login('ADA@EXAMPLE.TEST');
    expect(result.statusCode).toBe(200);
    expect(result.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.json().user.email).toBe('ada@example.test');
  });

  it('uses uniform credentials error for unknown user and wrong password', async () => {
    const unknown = await login('absent@example.test');
    const wrong = await login('ada@example.test', 'wrong-password');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
  });

  it('enforces roles on writes: viewer blocked (403), operator allowed (201)', async () => {
    resetLoginLimiter();
    const viewerPost = await app.inject({ method: 'POST', url: '/v1/ledger/entries', headers: { authorization: `Bearer ${viewerToken}`, 'idempotency-key': 'v-1' }, payload: { type: 'CHARGE', amountCents: 100 } });
    expect(viewerPost.statusCode).toBe(403);
    const viewerEnroll = await app.inject({ method: 'POST', url: '/v1/enrollments', headers: { authorization: `Bearer ${viewerToken}`, 'idempotency-key': 'v-2' }, payload: { studentId: 's', offerId: 'o' } });
    expect(viewerEnroll.statusCode).toBe(403);
    const operatorPost = await app.inject({ method: 'POST', url: '/v1/ledger/entries', headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'o-1' }, payload: { type: 'CHARGE', amountCents: 100 } });
    expect(operatorPost.statusCode).toBe(201);
    const viewerRead = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { authorization: `Bearer ${viewerToken}` } });
    expect(viewerRead.statusCode).toBe(200);
  });

  it('requires bearer on domain endpoints, tenant derives from session (forged header ignored)', async () => {
    resetLoginLimiter();
    const anonymous = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { 'x-tenant-id': 'A' } });
    expect(anonymous.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${viewerToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.tenantId).toBe('A');
    await db.pool.query("INSERT INTO ledger_entries (id, tenant_id, type, amount_cents) VALUES ('only-b', 'B', 'CHARGE', 99)");
    const forged = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { authorization: `Bearer ${viewerToken}`, 'x-tenant-id': 'B' } });
    expect(forged.json().balanceCents).toBe(100); // saldo do tenant A da sessão; 'only-b' (B) não entra
  });

  it('revokes session on logout', async () => {
    const token = await seedUser('logout@example.test', 'viewer');
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('rate limits login after ten attempts per IP', async () => {
    resetLoginLimiter();
    // 10 tentativas com senha errada consomem a janela do IP (11ª → 429)
    for (let i = 0; i < 10; i++) await login('ada@example.test', `wrong-${i}`);
    const limited = await login('ada@example.test', password);
    expect(limited.statusCode).toBe(429);
  });

  it('user id is UUID (schema contract)', async () => {
    const row = await db.pool.query('SELECT id FROM users WHERE email = $1', ['ada@example.test']);
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(row.rows[0].id))).toBe(true);
  });
});
