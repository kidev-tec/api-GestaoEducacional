/**
 * E06-C E2E — tarefas follow-up + round-robin + timeline (Postgres real).
 */
import { randomUUID } from 'node:crypto';
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
    [randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function userIdByEmail(email: string): Promise<string> {
  const r = await db.pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return (r.rows[0] as { id: string }).id;
}

async function createLead(email: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email, source: 'website', consent: true } });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('E06-C tarefas/round-robin', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e06c@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('RF-01: cria/conclui/cancela tarefa com validações', async () => {
    const leadId = await createLead('e06c-l1@test.com');
    const u1 = await userIdByEmail('e06c@test.com');
    const bad = await app.inject({ method: 'POST', url: '/v1/crm/tasks', headers: H(), payload: { leadId, assignedTo: u1, kind: 'call', dueAt: new Date(Date.now() - 1000).toISOString() } });
    expect(bad.statusCode).toBe(422);
    const ok = await app.inject({ method: 'POST', url: '/v1/crm/tasks', headers: H(), payload: { leadId, assignedTo: u1, kind: 'call', dueAt: future(24), notes: 'ligar' } });
    expect(ok.statusCode).toBe(201);
    const taskId = (ok.json() as { id: string }).id;
    const done = await app.inject({ method: 'POST', url: `/v1/crm/tasks/${taskId}/done`, headers: H() });
    expect(done.statusCode).toBe(200);
    const doneAgain = await app.inject({ method: 'POST', url: `/v1/crm/tasks/${taskId}/done`, headers: H() });
    expect(doneAgain.statusCode).toBe(200); // idempotente
    const noCancel = await app.inject({ method: 'POST', url: `/v1/crm/tasks/${taskId}/cancel`, headers: H(), payload: { reason: 'ab' } });
    expect(noCancel.statusCode).toBe(422);
    const t2 = await app.inject({ method: 'POST', url: '/v1/crm/tasks', headers: H(), payload: { leadId, assignedTo: u1, kind: 'email', dueAt: future(48) } });
    const t2id = (t2.json() as { id: string }).id;
    const canceled = await app.inject({ method: 'POST', url: `/v1/crm/tasks/${t2id}/cancel`, headers: H(), payload: { reason: 'cliente desistiu' } });
    expect(canceled.statusCode).toBe(200);
    expect((canceled.json() as { status: string }).status).toBe('canceled');
  });

  it('RF-02: round-robin distribui circularmente entre 3 users', async () => {
    const emails = ['rr1@t.com', 'rr2@t.com', 'rr3@t.com'];
    for (const e of emails) await login(e, 'A');
    const ids: string[] = [];
    for (const e of emails) ids.push(await userIdByEmail(e));
    for (const id of ids) {
      const r = await app.inject({ method: 'POST', url: '/v1/crm/rotation', headers: H(), payload: { userId: id } });
      expect(r.statusCode).toBe(201);
    }
    const leadId = await createLead('e06c-rr@test.com');
    const assigned: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/crm/rotation/assign', headers: H(), payload: { leadId, kind: 'call', dueAt: future(24 + i) } });
if (r.statusCode !== 201) console.error('ASSIGN_FAIL', r.body);
      expect(r.statusCode).toBe(201);
      assigned.push((r.json() as { assignedTo: string }).assignedTo);
    }
    // circular: u1,u2,u3,u1,u2,u3
    expect(assigned).toEqual([ids[0], ids[1], ids[2], ids[0], ids[1], ids[2]]);
    // remove e rotação segue com 2
    const del = await app.inject({ method: 'DELETE', url: `/v1/crm/rotation/${ids[0]}`, headers: H() });
    expect(del.statusCode).toBe(200);
    const r2 = await app.inject({ method: 'POST', url: '/v1/crm/rotation/assign', headers: H(), payload: { leadId, kind: 'email', dueAt: future(30) } });
    expect(r2.statusCode).toBe(201);
    expect([(ids[1]), (ids[2])]).toContain((r2.json() as { assignedTo: string }).assignedTo);
  });

  it('RF-03: overdue listing + RF-04 timeline unificado + cross-tenant 404', async () => {
    const leadId = await createLead('e06c-tl@test.com');
    const u1 = await userIdByEmail('e06c@test.com');
    // tarefa vencida: cria com due futuro e reescreve direto no DB
    const t = await app.inject({ method: 'POST', url: '/v1/crm/tasks', headers: H(), payload: { leadId, assignedTo: u1, kind: 'visit', dueAt: future(2) } });
    const tid = (t.json() as { id: string }).id;
    await db.pool.query("UPDATE crm_tasks SET due_at = now() - interval '1 hour' WHERE id = $1", [tid]);
    const overdue = await app.inject({ method: 'GET', url: '/v1/crm/tasks?overdue=true', headers: H() });
    expect(overdue.statusCode).toBe(200);
    const list = overdue.json() as Array<{ id: string }>;
    expect(list.some((x) => x.id === tid)).toBe(true);

    // move lead no funil p/ ter histórico
    const stg = await db.pool.query("SELECT id FROM pipeline_stages WHERE tenant_id='A' AND label='Em contato' AND archived=false");
    const toStage = (stg.rows[0] as { id: string }).id;
    const mv = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/move`, headers: H(), payload: { toStageId: toStage } });
    expect(mv.statusCode).toBe(200);

    const tl = await app.inject({ method: 'GET', url: `/v1/leads/${leadId}/timeline`, headers: H() });
    if (tl.statusCode !== 200) console.error('TL_FAIL', tl.body);
    expect(tl.statusCode).toBe(200);
    const entries = tl.json() as Array<{ type: string }>;
    expect(entries.some((e) => e.type === 'stage')).toBe(true);
    expect(entries.some((e) => e.type === 'task')).toBe(true);

    // cross-tenant: lead de A não visível p/ B
    const tkB = await login('e06c-b@test.com', 'B');
    const tlB = await app.inject({ method: 'GET', url: `/v1/leads/${leadId}/timeline`, headers: { authorization: `Bearer ${tkB}` } });
    expect(tlB.statusCode).toBe(404);

    // SLA default
    const sla = await app.inject({ method: 'GET', url: '/v1/crm/sla', headers: H() });
    expect(sla.statusCode).toBe(200);
    expect((sla.json() as { slaHours: number }).slaHours).toBe(48);
  });
});
