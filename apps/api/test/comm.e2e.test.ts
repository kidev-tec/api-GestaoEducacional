/**
 * E09-01 E2E — matriz de eventos e fila local (Postgres real).
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

describe('E09-01 comunicação', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0901@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });


  it('ISOL: token de outro tenant não vê dados', async () => {
    const t2 = await db.pool.query('INSERT INTO tenants (id) VALUES ($1) RETURNING id', [crypto.randomUUID()]);
    const t2id = t2.rows[0]!.id as string;
    const argon = await import('argon2');
    await db.pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [crypto.randomUUID(), t2id, 'isol-comm@test.com', await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
    );
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'isol-comm@test.com', password: 'correct-horse-123' } });
    const tok2 = (r.json() as { token: string }).token;
    const list = await app.inject({ method: 'GET', url: '/v1/comm-messages', headers: { authorization: `Bearer ${tok2}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(0);
  });
  it('ciclo: def → enqueue → deliver → stats; regras adversariais; opt-out → SKIPPED', async () => {
    // def inválida (slug) → AJV 400
    const badDef = await app.inject({ method: 'POST', url: '/v1/comm-event-defs', headers: H(), payload: { eventKey: 'BAD KEY', channel: 'inapp', name: 'x', templateBody: 'y' } });
    expect(badDef.statusCode).toBe(400);
    // def válida
    const def = await app.inject({ method: 'POST', url: '/v1/comm-event-defs', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'inapp', name: 'Matrícula criada', templateSubject: 'Bem-vindo', templateBody: 'Olá {{student}}' } });
    expect(def.statusCode).toBe(201);
    const defId = (def.json() as { id: string }).id;
    // enqueue sem def registrada p/ outro evento → 404
    const noDef = await app.inject({ method: 'POST', url: '/v1/comm-messages', headers: H(), payload: { eventKey: 'outro.evento', channel: 'inapp', payload: {} } });
    expect(noDef.statusCode).toBe(404);
    // enqueue ok
    const enq = await app.inject({ method: 'POST', url: '/v1/comm-messages', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'inapp', payload: { student: 'Zé' } } });
    expect(enq.statusCode).toBe(201);
    const msgId = (enq.json() as { id: string }).id;
    expect((enq.json() as { status: string }).status).toBe('QUEUED');
    // deliver
    const del = await app.inject({ method: 'POST', url: `/v1/comm-messages/${msgId}/deliver`, headers: H(), payload: {} });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { status: string }).status).toBe('DELIVERED_LOCAL');
    // replay idempotente
    const del2 = await app.inject({ method: 'POST', url: `/v1/comm-messages/${msgId}/deliver`, headers: H(), payload: {} });
    expect(del2.statusCode).toBe(200);
    // disable def → enqueue 422
    const dis = await app.inject({ method: 'PATCH', url: `/v1/comm-event-defs/${defId}`, headers: H(), payload: { enabled: false } });
    expect(dis.statusCode).toBe(200);
    const enq2 = await app.inject({ method: 'POST', url: '/v1/comm-messages', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'inapp', payload: {} } });
    expect(enq2.statusCode).toBe(422);
    await app.inject({ method: 'PATCH', url: `/v1/comm-event-defs/${defId}`, headers: H(), payload: { enabled: true } });
    // opt-out: cria lead + opt-out, enfileira com leadId → SKIPPED
    const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email: 'e0901-lead@test.com', source: 'website', consent: true } });
    const leadId = (lr.json() as { id: string }).id;
    await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/opt-out`, headers: H(), payload: {} });
    const enq3 = await app.inject({ method: 'POST', url: '/v1/comm-messages', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'inapp', payload: {}, leadId } });
    expect(enq3.statusCode).toBe(201);
    expect((enq3.json() as { status: string; skipReason: string }).status).toBe('SKIPPED');
    expect((enq3.json() as { skipReason: string }).skipReason).toBe('opt-out');
    // stats
    const stats = await app.inject({ method: 'GET', url: '/v1/comm-stats', headers: H() });
    expect(stats.statusCode).toBe(200);
    const arr = stats.json() as Array<{ channel: string; status: string; n: number }>;
    expect(arr.some((x) => x.status === 'DELIVERED_LOCAL')).toBe(true);
    expect(arr.some((x) => x.status === 'SKIPPED')).toBe(true);
  });

  it('comm-sync: outbox pendente → comm_messages por def habilitado', async () => {
    await db.pool.query(
      "INSERT INTO outbox_events (id, tenant_id, type, version, payload) VALUES ($1, 'A', 'enrollment.created', '1', '{}')",
      [crypto.randomUUID()],
    );
    // def inapp + email
    await app.inject({ method: 'POST', url: '/v1/comm-event-defs', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'email', name: 'Matrícula email', templateBody: 'Corpo email' } });
    const sync = await app.inject({ method: 'POST', url: '/v1/comm-sync', headers: H(), payload: {} });
    expect(sync.statusCode).toBe(200);
    const { created } = sync.json() as { created: number };
    expect(created).toBeGreaterThanOrEqual(2); // inapp + email
    const list = await app.inject({ method: 'GET', url: '/v1/comm-messages?status=QUEUED', headers: H() });
    expect((list.json() as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});
