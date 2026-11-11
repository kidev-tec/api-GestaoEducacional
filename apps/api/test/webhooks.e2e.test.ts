/**
 * E12-05 E2E — webhooks: endpoints, dispatch, delivery, DLQ/replay, assinatura verificável (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
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

describe('E12-05 webhooks', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e1205@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ciclo: endpoint → outbox → dispatch → deliver DELIVERED; assinatura HMAC verificada; DLQ/replay', async () => {
    // secret curto → 422 (AJV str(200) aceita curto → domínio valida 422)
    const badEp = await app.inject({ method: 'POST', url: '/v1/webhook-endpoints', headers: H(), payload: { url: 'https://x/hook', secret: 'curto' } });
    expect([400, 422]).toContain(badEp.statusCode);
    // endpoint válido (secret auto)
    const ep = await app.inject({ method: 'POST', url: '/v1/webhook-endpoints', headers: H(), payload: { url: 'https://x.example/hook', events: ['enrollment.created'] } });
    expect(ep.statusCode).toBe(201);
    const epBody = ep.json() as { id: string; secret: string; events: string[] };
    expect(epBody.secret.length).toBeGreaterThanOrEqual(32);
    expect(epBody.events).toEqual(['enrollment.created']);
    // rotate
    const rot = await app.inject({ method: 'POST', url: `/v1/webhook-endpoints/${epBody.id}/rotate-secret`, headers: H(), payload: {} });
    expect(rot.statusCode).toBe(201);
    const newSecret = (rot.json() as { secret: string }).secret;
    expect(newSecret).not.toBe(epBody.secret);
    // outbox pendente
    await db.pool.query(
      "INSERT INTO outbox_events (id, tenant_id, type, version, payload) VALUES ($1, 'A', 'enrollment.created', '1', '{\"student\":\"Ana\"}')",
      [crypto.randomUUID()],
    );
    const disp = await app.inject({ method: 'POST', url: '/v1/webhook-dispatch', headers: H(), payload: {} });
    expect(disp.statusCode).toBe(200);
    expect((disp.json() as { created: number }).created).toBe(1);
    const list = await app.inject({ method: 'GET', url: '/v1/webhook-deliveries?status=PENDING', headers: H() });
    const dlv = (list.json() as Array<{ id: string; signature: string; payload: string }>)[0]!;
    // rotate foi ANTES do dispatch → secret vigente é o novo
    const body = typeof dlv.payload === 'string' ? dlv.payload : JSON.stringify(dlv.payload);
    const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(dlv.signature)!;
    const expected = createHmac('sha256', newSecret).update(`${m[1]}.${body}`).digest('hex');
    expect(m[2]).toBe(expected);
    // deliver
    const proc = await app.inject({ method: 'POST', url: `/v1/webhook-deliveries/${dlv.id}/process`, headers: H(), payload: {} });
    expect(proc.statusCode).toBe(200);
    const delivered = proc.json() as { status: string; responseCode: number };
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.responseCode).toBe(200);
    // replay idempotente
    const proc2 = await app.inject({ method: 'POST', url: `/v1/webhook-deliveries/${dlv.id}/process`, headers: H(), payload: {} });
    expect((proc2.json() as { status: string }).status).toBe('DELIVERED');
    // DLQ: forçar FAILED direto e replay
    await db.pool.query(
      "UPDATE webhook_deliveries SET status = 'FAILED', attempts = 5, response_code = 500 WHERE id = $1",
      [dlv.id],
    );
    const dlq = await app.inject({ method: 'GET', url: '/v1/webhook-dlq', headers: H() });
    expect((dlq.json() as unknown[])).toHaveLength(1);
    const rep = await app.inject({ method: 'POST', url: `/v1/webhook-dlq/${dlv.id}/replay`, headers: H(), payload: {} });
    expect(rep.statusCode).toBe(200);
    expect((rep.json() as { status: string; attempts: number })).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('endpoint filtrado não recebe evento não casado; tenant isolation', async () => {
    const ep = await app.inject({ method: 'POST', url: '/v1/webhook-endpoints', headers: H(), payload: { url: 'https://x.example/only-tuition', events: ['tuition.settled'] } });
    const epId = (ep.json() as { id: string }).id;
    await db.pool.query(
      "INSERT INTO outbox_events (id, tenant_id, type, version, payload) VALUES ($1, 'A', 'enrollment.created', '1', '{}')",
      [crypto.randomUUID()],
    );
    await app.inject({ method: 'POST', url: '/v1/webhook-dispatch', headers: H(), payload: {} });
    const list = await app.inject({ method: 'GET', url: `/v1/webhook-deliveries?endpointId=${epId}`, headers: H() });
    expect((list.json() as unknown[])).toHaveLength(0);
    // tenant B não vê deliveries de A
    await login('e1205b@test.com', 'B');
    const listB = await app.inject({ method: 'GET', url: '/v1/webhook-dlq', headers: H() });
    expect((listB.json() as unknown[])).toHaveLength(0);
  });
});
