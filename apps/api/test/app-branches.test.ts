/**
 * E03-A QA — killers para branches sem cobertura em app.ts (revisão r1).
 * Contra Postgres real efêmero, mesmo padrão dos E2E existentes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, resetLoginLimiter } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminA = '';

const H = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
  resetLoginLimiter();
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), 'A', 'e03a-admin@test', hash, 'admin'],
  );
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'e03a-admin@test', password: 'correct-horse-123' } });
  adminA = (login.json() as { token: string }).token;
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

describe('E03-A · branches de guarda do app.ts', () => {
  it('register admin: body incompleto (sem email) → 400 invalid registration', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: H(adminA),
      payload: { password: 'x-pass-123', role: 'viewer' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'invalid registration' });
  });

  it('register admin: role inválida no body → 400 (branch do includes(role))', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: H(adminA),
      payload: { email: 'novo@test', password: 'x-pass-123', role: 'superadmin' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('login: credencial errada → 401 (nunca 500/rethrow)', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'ghost@test', password: 'wrong-pass' } });
    expect(r.statusCode).toBe(401);
  });

  it('POST /v1/tuition/plans com payload inválido → mapDomainError 400 (branch do catch)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/tuition/plans',
      headers: H(adminA),
      payload: { name: '', amountCents: -5, dueDay: 99 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toHaveProperty('error');
  });

  it('POST /v1/tuition/plans com dueDay fora da faixa → erro de domínio mapeado (branch L519)', async () => {
    // dueDay 32 viola a regra de domínio do insertPlan → mapDomainError
    const r = await app.inject({
      method: 'POST', url: '/v1/tuition/plans',
      headers: H(adminA),
      payload: { name: 'Plano Dia32', amountCents: 10000, dueDay: 32 },
    });
    expect([400, 422]).toContain(r.statusCode);
    expect(r.json()).toHaveProperty('error');
  });
});
