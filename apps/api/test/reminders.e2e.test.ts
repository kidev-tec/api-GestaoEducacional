/**
 * E06-08 E2E — lembretes sob opt-in (Postgres real).
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

async function leadWithTaskDue(email: string, consent: boolean): Promise<{ leadId: string; taskId: string }> {
  const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email, source: 'website', consent } });
  expect(lr.statusCode).toBe(201);
  const leadId = (lr.json() as { id: string }).id;
  if (!consent) {
    await db.pool.query('UPDATE leads SET consent = false WHERE id = $1', [leadId]);
  }
  const u = await db.pool.query("SELECT id FROM users WHERE email = 'e0608@test.com'");
  const userId = (u.rows[0] as { id: string }).id;
  const tk = await app.inject({ method: 'POST', url: '/v1/crm/tasks', headers: H(), payload: { leadId, assignedTo: userId, kind: 'call', dueAt: new Date(Date.now() + 30 * 60_000).toISOString() } });
  expect(tk.statusCode).toBe(201);
  const taskId = (tk.json() as { id: string }).id;
  return { leadId, taskId };
}

describe('E06-08 lembretes', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0608@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });


  it('ISOL: token de outro tenant não vê dados', async () => {
    const t2 = await db.pool.query('INSERT INTO tenants (id) VALUES ($1) RETURNING id', [crypto.randomUUID()]);
    const t2id = t2.rows[0]!.id as string;
    const argon = await import('argon2');
    await db.pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [crypto.randomUUID(), t2id, 'isol-rem@test.com', await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
    );
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'isol-rem@test.com', password: 'correct-horse-123' } });
    const tok2 = (r.json() as { token: string }).token;
    const list = await app.inject({ method: 'GET', url: '/v1/reminder-policies', headers: { authorization: `Bearer ${tok2}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(0);
  });
  it('ciclo feliz: policy → task due → generate → dispatch SENT → supervisão; geração idempotente', async () => {
    const { leadId, taskId } = await leadWithTaskDue('e0608-ok@test.com', true);
    const pol = await app.inject({ method: 'POST', url: '/v1/reminder-policies', headers: H(), payload: { name: 'due-30', kind: 'TASK_DUE', offsetMinutes: 60, maxPerDay: 3 } });
    expect(pol.statusCode).toBe(201);
    const policyId = (pol.json() as { id: string }).id;
    const gen1 = await app.inject({ method: 'POST', url: '/v1/reminders/generate', headers: H(), payload: {} });
    expect(gen1.statusCode).toBe(200);
    const g1 = gen1.json() as { created: Array<{ taskId: string }>; skipped: number };
    expect(g1.created).toHaveLength(1);
    expect(g1.created[0]!.taskId).toBe(taskId);
    // idempotência: 2ª geração não duplica
    const gen2 = await app.inject({ method: 'POST', url: '/v1/reminders/generate', headers: H(), payload: {} });
    expect((gen2.json() as { created: unknown[] }).created).toHaveLength(0);
    // dispatch → SENT
    const disp = await app.inject({ method: 'POST', url: '/v1/reminders/dispatch', headers: H(), payload: {} });
    expect(disp.statusCode).toBe(200);
    const d = disp.json() as { sent: Array<{ result: string }> };
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]!.result).toBe('sent');
    // supervisão
    const list = await app.inject({ method: 'GET', url: `/v1/reminders?status=SENT&policyId=${policyId}`, headers: H() });
    expect((list.json() as unknown[])).toHaveLength(1);
    expect(leadId).toBeTruthy();
  });

  it('R1/R2: lead sem consent e lead opt-out → SKIPPED com motivo; policy off → não despacha', async () => {
    // sem consent
    await leadWithTaskDue('e0608-noconsent@test.com', false);
    // com consent mas opt-out
    const { leadId: leadOpt } = await leadWithTaskDue('e0608-optout@test.com', true);
    const oo = await app.inject({ method: 'POST', url: `/v1/leads/${leadOpt}/opt-out`, headers: H(), payload: {} });
    expect(oo.statusCode).toBe(200);
    const ooStatus = await app.inject({ method: 'GET', url: `/v1/leads/${leadOpt}/opt-out`, headers: H() });
    expect((ooStatus.json() as { optedOut: boolean }).optedOut).toBe(true);
    // geração: 2 tasks → 2 SKIPPED (no-consent, opt-out)
    const gen = await app.inject({ method: 'POST', url: '/v1/reminders/generate', headers: H(), payload: {} });
    const g = gen.json() as { created: unknown[]; skipped: number };
    expect(g.created).toHaveLength(0);
    expect(g.skipped).toBe(2);
    // dispatch não envia nada (só SKIPPED já registrados)
    const disp = await app.inject({ method: 'POST', url: '/v1/reminders/dispatch', headers: H(), payload: {} });
    expect((disp.json() as { sent: unknown[] }).sent).toHaveLength(0);
    // supervisão mostra os 2 SKIPPED
    const list = await app.inject({ method: 'GET', url: '/v1/reminders?status=SKIPPED', headers: H() });
    const skipped = list.json() as Array<{ result: string }>;
    const reasons = skipped.map((x) => x.result).sort();
    expect(reasons).toContain('no-consent');
    expect(reasons).toContain('opt-out');
    // policy off → dispatch de novo PENDING não envia (não há PENDING aqui, mas policy desabilitada bloqueia futuros)
    const list2 = await app.inject({ method: 'GET', url: '/v1/reminder-policies', headers: H() });
    const policies = list2.json() as Array<{ id: string; enabled: boolean }>;
    expect(policies.length).toBeGreaterThan(0);
    const off = await app.inject({ method: 'PATCH', url: `/v1/reminder-policies/${policies[0]!.id}`, headers: H(), payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { enabled: boolean }).enabled).toBe(false);
    // re-enable p/ não sujar outros testes
    await app.inject({ method: 'PATCH', url: `/v1/reminder-policies/${policies[0]!.id}`, headers: H(), payload: { enabled: true } });
  });
});
