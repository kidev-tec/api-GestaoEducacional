/**
 * E11-01 E2E — catálogo de métricas com seed, compute e snapshots (Postgres real).
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

describe('E11-01 métricas', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e1101@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('seed 7 métricas; compute snapshot; duplicado 409; whitelist e adversariais; snapshots listáveis', async () => {
    // seed
    const list = await app.inject({ method: 'GET', url: '/v1/metrics', headers: H() });
    const metrics = list.json() as Array<{ key: string; granularity: string; active: boolean }>;
    expect(metrics.map((m) => m.key).sort()).toEqual(
      ['active_enrollments', 'classes_open', 'lead_conversion_rate', 'overdue_tasks', 'pipeline_value', 'revenue_month', 'sessions_week'],
    );
    // compute revenue_month (MONTH) p/ tenant A
    const comp = await app.inject({ method: 'POST', url: '/v1/metrics/revenue_month/compute', headers: H(), payload: { from: '2026-11-01', to: '2026-11-30' } });
    if (comp.statusCode !== 200) console.error('COMP_FAIL', comp.statusCode, comp.body);
    expect(comp.statusCode).toBe(200);
    const { saved, values } = comp.json() as { saved: number; values: Array<{ value: string }> };
    expect(saved).toBe(1);
    expect(values[0]!.value).toBe('0'); // sem lançamentos
    // duplicado → 409
    const dup = await app.inject({ method: 'POST', url: '/v1/metrics/revenue_month/compute', headers: H(), payload: { from: '2026-11-01', to: '2026-11-30' } });
    expect(dup.statusCode).toBe(409);
    // snapshots
    const snaps = await app.inject({ method: 'GET', url: '/v1/metrics/revenue_month/snapshots?from=2026-11-01&to=2026-11-30', headers: H() });
    expect((snaps.json() as unknown[])).toHaveLength(1);
    // criar métrica com tabela fora da whitelist → 422
    const badTable = await app.inject({ method: 'POST', url: '/v1/metrics', headers: H(), payload: {
      key: 'hack', name: 'Hack', granularity: 'DAY', formulaSql: 'SELECT * FROM users', sourceTables: ['users'],
    } });
    expect(badTable.statusCode).toBe(422);
    // fórmula sem SELECT → 422
    const badSql = await app.inject({ method: 'POST', url: '/v1/metrics', headers: H(), payload: {
      key: 'del', name: 'Del', granularity: 'DAY', formulaSql: 'DELETE FROM leads', sourceTables: ['leads'],
    } });
    expect(badSql.statusCode).toBe(422);
    // criar válida e computar
    const ok = await app.inject({ method: 'POST', url: '/v1/metrics', headers: H(), payload: {
      key: 'active_leads', name: 'Leads ativos', granularity: 'DAY',
      formulaSql: 'SELECT COUNT(*)::numeric FROM leads WHERE tenant_id = $1 AND created_at < $3', sourceTables: ['leads'],
    } });
    expect(ok.statusCode).toBe(201);
    const comp2 = await app.inject({ method: 'POST', url: '/v1/metrics/active_leads/compute', headers: H(), payload: { from: '2026-11-10', to: '2026-11-12' } });
    if (comp2.statusCode !== 200) console.error('COMP2_FAIL', comp2.statusCode, comp2.body);
    expect(comp2.statusCode).toBe(200);
    expect((comp2.json() as { saved: number }).saved).toBe(3); // DAY: 3 períodos
    // range inválido → 422
    const badRange = await app.inject({ method: 'POST', url: '/v1/metrics/revenue_month/compute', headers: H(), payload: { from: '2026-12-01', to: '2026-11-01' } });
    expect(badRange.statusCode).toBe(422);
    // update owner/active
    const upd = await app.inject({ method: 'PATCH', url: '/v1/metrics/revenue_month', headers: H(), payload: { active: false } });
    expect(upd.statusCode).toBe(200);
    // compute de inativa → 422
    const compOff = await app.inject({ method: 'POST', url: '/v1/metrics/revenue_month/compute', headers: H(), payload: { from: '2026-12-01', to: '2026-12-30' } });
    expect(compOff.statusCode).toBe(422);
    // 404
    const nf = await app.inject({ method: 'GET', url: '/v1/metrics/zzz', headers: H() });
    expect(nf.statusCode).toBe(404);
  });
});
