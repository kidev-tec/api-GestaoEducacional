/**
 * E12-02 E2E — importador CSV: dry-run, relatório, commit idempotente (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });
let tenantA = '';
let unitId = '';

async function login(email: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenantA, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

describe('E12-02 importador CSV', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantA = t.rows[0]!.id as string;
    const u = await db.pool.query(
      'INSERT INTO units (id, tenant_id, name) VALUES ($1,$2,$3) RETURNING id',
      [crypto.randomUUID(), tenantA, 'Unidade Import'],
    );
    unitId = u.rows[0]!.id as string;
    token = await login('e1202@test.com');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ISOL: token de outro tenant não vê jobs', async () => {
    const t2 = await db.pool.query("INSERT INTO tenants (id) VALUES ($1) RETURNING id", [crypto.randomUUID()]);
    const t2id = t2.rows[0]!.id as string;
    const argon = await import('argon2');
    await db.pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [crypto.randomUUID(), t2id, 'iso1202@test.com', await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
    );
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'iso1202@test.com', password: 'correct-horse-123' } });
    const tok2 = (r.json() as { token: string }).token;
    const list = await app.inject({ method: 'GET', url: '/v1/imports', headers: { authorization: `Bearer ${tok2}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(0);
  });

  it('dry-run com erros; commit insere válidos; re-commit 409; idempotente por email', async () => {
    const csv = [
      'name,email,phone,document,kind',
      'Ana Import,ana-imp@x.com,14998887766,11122233344,STUDENT',
      'Bob Import,bob-imp@x.com,,,GUARDIAN',
      ',email-ruim,,,STUDENT',
      'Carla Import,carla-imp@x.com,,,STUDENT',
    ].join('\n');
    const created = await app.inject({ method: 'POST', url: '/v1/imports', headers: H(), payload: {
      entity: 'people', csv,
      mapping: { name: 'name', email: 'email', phone: 'phone', document: 'document', kind: 'kind' },
    } });
    if (created.statusCode !== 201) console.error('IMP_FAIL', created.statusCode, created.body);
    expect(created.statusCode).toBe(201);
    const job = created.json() as { id: string; totalRows: number; validRows: number; errorRows: number; status: string };
    expect(job.totalRows).toBe(4);
    expect(job.validRows).toBe(3);
    expect(job.errorRows).toBe(1);
    expect(job.status).toBe('DRY_RUN');
    // mapping sem name → 422
    const badMap = await app.inject({ method: 'POST', url: '/v1/imports', headers: H(), payload: {
      entity: 'people', csv, mapping: { email: 'email' },
    } });
    if (badMap.statusCode !== 422) console.error('BADM', badMap.statusCode, badMap.body.slice(0,200));
    expect(badMap.statusCode).toBe(422);
    // CSV > 2 MB → 422
    const bigCsv = await app.inject({ method: 'POST', url: '/v1/imports', headers: H(), payload: {
      entity: 'people', csv: 'x'.repeat(2 * 1024 * 1024 + 5), mapping: { name: 'name' },
    } });
    if (![400, 413, 422].includes(bigCsv.statusCode)) console.error('BIG', bigCsv.statusCode);
    expect([400, 413, 422]).toContain(bigCsv.statusCode);
    // get job
    const got = await app.inject({ method: 'GET', url: `/v1/imports/${job.id}`, headers: H() });
    expect(got.statusCode).toBe(200);
    // commit
    const commit = await app.inject({ method: 'POST', url: `/v1/imports/${job.id}/commit`, headers: H(), payload: { unitId } });
    if (commit.statusCode !== 200) console.error('COMMIT_FAIL', commit.statusCode, commit.body);
    expect(commit.statusCode).toBe(200);
    const r = commit.json() as { inserted: number; skipped: number };
    expect(r.inserted).toBe(3);
    expect(r.skipped).toBe(0);
    // re-commit → 409
    const recommit = await app.inject({ method: 'POST', url: `/v1/imports/${job.id}/commit`, headers: H(), payload: { unitId } });
    expect(recommit.statusCode).toBe(409);
    // idempotência por email: mesmo CSV → skip 3
    const created2 = await app.inject({ method: 'POST', url: '/v1/imports', headers: H(), payload: {
      entity: 'people', csv, mapping: { name: 'name', email: 'email', phone: 'phone', document: 'document', kind: 'kind' },
    } });
    const job2 = created2.json() as { id: string };
    const commit2 = await app.inject({ method: 'POST', url: `/v1/imports/${job2.id}/commit`, headers: H(), payload: { unitId } });
    const r2 = commit2.json() as { inserted: number; skipped: number };
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(3);
    // lista contém 2 jobs
    const list = await app.inject({ method: 'GET', url: '/v1/imports', headers: H() });
    expect((list.json() as unknown[]).length).toBeGreaterThanOrEqual(2);
    // 404 commit job inexistente
    const nf = await app.inject({ method: 'POST', url: `/v1/imports/${crypto.randomUUID()}/commit`, headers: H(), payload: { unitId } });
    expect(nf.statusCode).toBe(404);
  });
});
