import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, resetLoginLimiter } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
const password = 'correct-horse-123';

async function register(email: string, tenantId = 'A') {
  return app.inject({ method: 'POST', url: '/v1/auth/register', payload: { tenantId, email, password } });
}
async function login(email: string, pass = password) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: pass } });
}

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

describe('E04-A auth', () => {
  it('registers only viewer, stores no plaintext, and issues opaque session', async () => {
    const created = await register('ada@example.test');
    expect(created.statusCode).toBe(201);
    const userId = created.json().userId as string;
    const stored = await db.pool.query('SELECT password_hash, role FROM users WHERE id = $1', [userId]);
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0].password_hash).not.toContain(password);
    expect(stored.rows[0].role).toBe('viewer');
    const result = await login('ada@example.test');
    expect(result.statusCode).toBe(200);
    expect(result.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.json().user.email).toBe('ada@example.test');
  });

  it('does not allow role escalation or weak password', async () => {
    const elevated = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { tenantId: 'A', email: 'evil@test', password, role: 'admin' } });
    expect(elevated.statusCode).toBe(400);
    const weak = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { tenantId: 'A', email: 'weak@test', password: 'short' } });
    expect(weak.statusCode).toBe(400);
  });

  it('uses uniform credentials error for unknown user and wrong password', async () => {
    const unknown = await login('absent@example.test');
    const wrong = await login('ada@example.test', 'wrong-password');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
  });

  it('requires bearer on domain endpoints, ignores forged tenant header, and exposes me', async () => {
    resetLoginLimiter(); // isolamento do limiter em memória entre testes
    const anonymous = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { 'x-tenant-id': 'A' } });
    expect(anonymous.statusCode).toBe(401);
    const loginRes = await login('ada@example.test');
    if (loginRes.statusCode !== 200) console.error('LOGIN_FAIL', loginRes.statusCode, loginRes.body); expect(loginRes.statusCode).toBe(200);
    const session = loginRes.json() as { token: string };
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${session.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.tenantId).toBe('A');
    const forged = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { authorization: `Bearer ${session.token}`, 'x-tenant-id': 'B' } });
    expect(forged.statusCode).toBe(200);
    await db.pool.query("INSERT INTO ledger_entries (id, tenant_id, type, amount_cents) VALUES ('only-b', 'B', 'CHARGE', 99)");
    expect((await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: { authorization: `Bearer ${session.token}`, 'x-tenant-id': 'B' } })).json().balanceCents).toBe(0);
  });

  it('revokes session on logout', async () => {
    const token = (await login('ada@example.test')).json().token as string;
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('rate limits login after ten attempts per IP', async () => {
    for (let i = 0; i < 9; i++) await login(`rate-${i}@test`);
    const limited = await login('rate-last@test');
    expect(limited.statusCode).toBe(429);
  });
});
