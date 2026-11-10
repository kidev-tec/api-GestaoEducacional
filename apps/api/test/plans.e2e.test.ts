import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};

async function login(tenant: string): Promise<string> {
  if (tokens[tenant]) return tokens[tenant];
  const email = `plans-${tenant}@test`;
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), tenant, email, hash, 'operator'],
  );
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  tokens[tenant] = (res.json() as { token: string }).token;
  return tokens[tenant];
}

async function makeUnit(token: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `Bearer ${token}` }, payload: { name: `U ${randomUUID().slice(0, 6)}` } });
  return (r.json() as { id: string }).id;
}

describe('E13-A plans + entitlements + grandfathering', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
  }, 180_000);

  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('trial sem plano: STUDENT criado livremente (UNLIMITED)', async () => {
    const token = await login('A');
    const unitId = await makeUnit(token);
    const r = await app.inject({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'STUDENT', name: 'Trial Kid', unitId } });
    expect(r.statusCode).toBe(201);
    const cur = await app.inject({ method: 'GET', url: '/v1/plans/current', headers: { authorization: `Bearer ${token}` } });
    expect(cur.statusCode).toBe(200);
    expect((cur.json() as { plan: unknown }).plan).toBeNull();
  });

  it('POST /v1/plans cria catálogo; code dup → 409; code inválido → 422; viewer → 403', async () => {
    const op = await login('A');
    const r1 = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: `Bearer ${op}` }, payload: { code: `pl-${randomUUID().slice(0, 8)}`, name: 'Starter', priceCents: 9900, modules: ['crm'], limits: { max_students: 1 } } });
    expect(r1.statusCode).toBe(201);
    const planA = r1.json() as { id: string; code: string };

    const dup = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: `Bearer ${op}` }, payload: { code: planA.code, name: 'X', priceCents: 1 } });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: `Bearer ${op}` }, payload: { code: 'INVALID CODE', name: 'X', priceCents: 1 } });
    expect(bad.statusCode).toBe(400); // AJV pattern rejeita na borda (400); regra 422 do repo coberta em unit

    // plano B sem crm p/ grandfathering
    const r2 = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: `Bearer ${op}` }, payload: { code: `pl-${randomUUID().slice(0, 8)}`, name: 'Basic', priceCents: 4900, modules: ['enrollment'], limits: { max_students: 1 } } });
    expect(r2.statusCode).toBe(201);
    const planB = r2.json() as { id: string };

    const list = await app.inject({ method: 'GET', url: '/v1/plans', headers: { authorization: `Bearer ${op}` } });
    expect((list.json() as { plans: unknown[] }).plans.length).toBeGreaterThanOrEqual(2);

    // viewer não cria
    const email = `plans-viewer@test`;
    const argon = await import('argon2');
    await db.pool.query('INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [randomUUID(), 'A', email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'viewer']);
    const vres = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
    const vtok = (vres.json() as { token: string }).token;
    const forbidden = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: `Bearer ${vtok}` }, payload: { code: 'nope-x', name: 'N', priceCents: 1 } });
    expect(forbidden.statusCode).toBe(403);

    // stash ids p/ próximos testes
    (globalThis as Record<string, unknown>).__planA = planA;
    (globalThis as Record<string, unknown>).__planB = planB;
  });

  it('assign aplica limites: max_students=1 → 2º STUDENT 403; GUARDIAN passa', async () => {
    const token = await login('B');
    const planA = (globalThis as unknown as { __planA: { id: string } }).__planA;
    const assign = await app.inject({ method: 'POST', url: '/v1/tenants/B/plan', headers: { authorization: `Bearer ${token}` }, payload: { planId: planA.id } });
    expect(assign.statusCode).toBe(204);

    const unitId = await makeUnit(token);
    const s1 = await app.inject({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'STUDENT', name: 'S1', unitId } });
    expect(s1.statusCode).toBe(201); // trial student já existe? B começa vazio → 1º ok (limite 1)
    const s2 = await app.inject({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'STUDENT', name: 'S2', unitId } });
    expect(s2.statusCode).toBe(403);
    expect((s2.json() as { error: string }).error).toContain('plan limit reached');
    const g = await app.inject({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'GUARDIAN', name: 'G', unitId } });
    expect(g.statusCode).toBe(201);

    const cur = await app.inject({ method: 'GET', url: '/v1/plans/current', headers: { authorization: `Bearer ${token}` } });
    expect((cur.json() as { plan: { code: string } | null }).plan).not.toBeNull();
  });

  it('cross-tenant assign → 404; plano inexistente → 404', async () => {
    const token = await login('B');
    const cross = await app.inject({ method: 'POST', url: '/v1/tenants/C/plan', headers: { authorization: `Bearer ${token}` }, payload: { planId: (globalThis as unknown as { __planA: { id: string } }).__planA.id } });
    expect(cross.statusCode).toBe(404);
    const ghost = await app.inject({ method: 'POST', url: '/v1/tenants/B/plan', headers: { authorization: `Bearer ${token}` }, payload: { planId: randomUUID() } });
    expect(ghost.statusCode).toBe(404);
  });

  it('grandfathering: downgrade p/ plano sem crm → crm PERMANECE habilitado', async () => {
    const token = await login('B');
    const before = await app.inject({ method: 'GET', url: '/v1/plans/current', headers: { authorization: `Bearer ${token}` } });
    expect((before.json() as { modules: string[] }).modules).toContain('crm'); // plano A tinha crm

    const planB = (globalThis as unknown as { __planB: { id: string } }).__planB;
    const down = await app.inject({ method: 'POST', url: '/v1/tenants/B/plan', headers: { authorization: `Bearer ${token}` }, payload: { planId: planB.id } });
    expect(down.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/v1/plans/current', headers: { authorization: `Bearer ${token}` } });
    const body = after.json() as { plan: { code: string } | null; modules: string[] };
    expect(body.plan).not.toBeNull();
    expect(body.modules).toContain('crm');  // grandfathering: não se perde
    expect(body.modules).toContain('enrollment'); // do plano novo
  });

  it('401 sem token em plans', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/plans/current' });
    expect(r.statusCode).toBe(401);
  });
});
