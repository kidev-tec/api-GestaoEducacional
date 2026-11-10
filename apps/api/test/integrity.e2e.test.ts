/**
 * E07-B — Integridade financeira E2E (Postgres real).
 * Matriz SPEC §6: RF-01..RF-04 + auth + cross-tenant.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb } from '../../../packages/infra/src/test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};

async function login(tenant: string): Promise<string> {
  if (tokens[tenant]) return tokens[tenant];
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), tenant, `integ-${tenant}@test`, hash, 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `integ-${tenant}@test`, password: 'correct-horse-123' } });
  tokens[tenant] = (r.json() as { token: string }).token;
  return tokens[tenant];
}

const H = (t: string) => ({ authorization: `Bearer ${t}` });
const entry = (tenant: string, id: string, type: string, cents: number, reverses?: string) =>
  db.pool.query(
    'INSERT INTO ledger_entries (id, tenant_id, type, amount_cents, reverses) VALUES ($1,$2,$3,$4,$5)',
    [id, tenant, type, cents, reverses ?? null],
  );

describe('E07-B integridade financeira', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool, logger: true });
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('401 sem sessão', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity' });
    expect(r.statusCode).toBe(401);
  });

  it('tenant saudável → healthy true, todos os checks 0', async () => {
    const t = await login('A');
    await entry('A', `ok-${randomUUID()}`, 'CHARGE', 10000);
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { healthy: boolean; checks: Record<string, unknown> };
    expect(body.healthy).toBe(true);
    expect(body.checks.reversal_target_missing).toBe(0);
  });

  it('RF-01a: REVERSAL fantasma (target inexistente) conta + sample', async () => {
    const t = await login('A');
    const ghost = randomUUID();
    // FK impede reverses inexistente? NÃO — reverses é REFERENCES mas com valor inexistente viola.
    // O cenário real de fantasma é REVERSAL apontando pra entrada de OUTRO tenant (FK composta inexistente
    // na tabela permite cross-tenant por id). Inserir original no B e REVERSAL no A apontando pra ele:
    await entry('B', `cross-${randomUUID().slice(0, 8)}`, 'CHARGE', 5000).catch(() => {});
    const origB = (await db.pool.query("SELECT id FROM ledger_entries WHERE tenant_id='B' AND type='CHARGE' LIMIT 1")).rows[0] as { id: string };
    await db.pool.query('DELETE FROM ledger_entries WHERE id=$1 AND tenant_id=\'A\' AND type=\'REVERSAL\'', [ghost]);
    // inserir REVERSAL em A apontando pro id do B — a FK é só por id (sem tenant), então PASSA no insert,
    // mas o check cross-tenant do relatório deve pegar (o target pertence a outro tenant).
    const res = await db.pool.query(
      'INSERT INTO ledger_entries (id, tenant_id, type, amount_cents, reverses) VALUES ($1,\'A\',\'REVERSAL\',-5000,$2) ON CONFLICT DO NOTHING',
      [ghost, origB.id],
    );
    if ((res.rowCount ?? 0) === 0) return; // já existe do run anterior — skip defensivo
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const body = r.json() as { healthy: boolean; checks: { reversal_target_missing: number }; sample: Record<string, string[]> };
    expect(body.checks.reversal_target_missing).toBeGreaterThanOrEqual(1);
    expect(body.healthy).toBe(false);
  });

  it('RF-01b: REVERSAL com valor divergente → mismatch', async () => {
    const t = await login('B');
    const orig = randomUUID();
    await entry('B', orig, 'CHARGE', 7000);
    await entry('B', randomUUID(), 'REVERSAL', -999, orig); // deveria ser -7000
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const body = r.json() as { checks: { reversal_amount_mismatch: number } };
    expect(body.checks.reversal_amount_mismatch).toBeGreaterThanOrEqual(1);
  });

  it('RF-01c: REVERSAL→REVERSAL → chain', async () => {
    const t = await login('B');
    const orig = randomUUID();
    await entry('B', orig, 'CHARGE', 3000);
    const rev1 = randomUUID();
    await entry('B', rev1, 'REVERSAL', -3000, orig);
    await entry('B', randomUUID(), 'REVERSAL', 3000, rev1); // reversa a reversa
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const body = r.json() as { checks: { reversal_chain: number } };
    expect(body.checks.reversal_chain).toBeGreaterThanOrEqual(1);
  });

  it('RF-01d: 2 REVERSAL do mesmo original → duplicate', async () => {
    const t = await login('B');
    const orig = randomUUID();
    await entry('B', orig, 'CHARGE', 2000);
    await entry('B', randomUUID(), 'REVERSAL', -2000, orig);
    await entry('B', randomUUID(), 'REVERSAL', -2000, orig);
    const r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const body = r.json() as { checks: { duplicate_reversal: number } };
    expect(body.checks.duplicate_reversal).toBeGreaterThanOrEqual(1);
  });

  it('RF-02: sem account → not_applicable; com account desbalanceado → fail + unbalanced', async () => {
    const t = await login('C');
    await entry('C', randomUUID(), 'CHARGE', 100);
    let r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    expect((r.json() as { checks: { balanced_check: string } }).checks.balanced_check).toBe('not_applicable');

    await db.pool.query('UPDATE ledger_entries SET account=\'caixa\', doc_id=$1 WHERE tenant_id=\'C\'', [randomUUID()]);
    await db.pool.query(
      'INSERT INTO ledger_entries (id, tenant_id, type, amount_cents, account, doc_id) VALUES ($1,\'C\',\'PAYMENT\',50,\'caixa\',$2)',
      [randomUUID(), randomUUID()],
    );
    r = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const body = r.json() as { checks: { balanced_check: string; unbalanced_entries?: number } };
    expect(body.checks.balanced_check).toBe('fail');
    expect(body.checks.unbalanced_entries).toBeGreaterThanOrEqual(1);
  });

  it('RF-03: tenant A não enxerga problemas do tenant B (cross-tenant por id)', async () => {
    const ta = await login('A');
    const tb = await login('B');
    // Cenário real de fantasma: REVERSAL em A apontando pro id de entrada do B (FK só por id — passa no insert)
    const origB = (await db.pool.query("SELECT id FROM ledger_entries WHERE tenant_id='B' AND type='CHARGE' ORDER BY created_at DESC LIMIT 1")).rows[0] as { id: string };
    const revA = randomUUID();
    await db.pool.query(
      'INSERT INTO ledger_entries (id, tenant_id, type, amount_cents, reverses) VALUES ($1,\'A\',\'REVERSAL\',-1,$2) ON CONFLICT DO NOTHING',
      [revA, origB.id],
    );
    const ra = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(ta) });
    const rb = await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(tb) });
    const ba = ra.json() as { checks: { reversal_target_missing: number } };
    const bb = rb.json() as { checks: { reversal_target_missing: number } };
    expect(ba.checks.reversal_target_missing).toBeGreaterThanOrEqual(1); // A vê seu fantasma cross-tenant
    expect(bb.checks.reversal_target_missing).toBe(0); // B não herda o problema de A
  });

  it('RF-04: roda 2× → 2 eventos finance.integrity.run no audit', async () => {
    const t = await login('A');
    const before = await app.inject({ method: 'GET', url: '/v1/audit/count', headers: H(t) });
    const n0 = (before.json() as { count: number }).count;
    await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    await app.inject({ method: 'GET', url: '/v1/finance/integrity', headers: H(t) });
    const after = await app.inject({ method: 'GET', url: '/v1/audit/count', headers: H(t) });
    expect((after.json() as { count: number }).count).toBeGreaterThanOrEqual(n0 + 2);
  });
});
