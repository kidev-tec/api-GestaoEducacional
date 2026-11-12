/**
 * E09-03 E2E — mensageria omnichannel em sandbox (Postgres real):
 * provider, opt-out, ciclo send→drain→webhook DELIVERED, webhook 401, FAILED por retry.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';
import { drainQueue, createSandboxAdapter, enqueueMessage } from '../../../packages/infra/src/messaging-repositories.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let tenantId = '';

async function login(email: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenantId, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'admin'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

describe('E09-03 mensageria sandbox', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantId = t.rows[0]!.id as string;
    adminToken = await login('e0903-admin@test.com');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('provider: upsert com config mascarada e canal inválido 400', async () => {
    const H = { authorization: `Bearer ${adminToken}` };
    const r = await app.inject({ method: 'PUT', url: `/v1/tenants/${tenantId}/messaging/providers`, headers: H, payload: {
      channel: 'WHATSAPP', providerName: 'meta-sandbox', config: { mode: 'sandbox', apiToken: 'sk-123' },
    } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { config: Record<string, unknown> };
    expect(body.config.mode).toBe('sandbox');
    expect(JSON.stringify(body.config)).not.toContain('sk-123');

    const bad = await app.inject({ method: 'PUT', url: `/v1/tenants/${tenantId}/messaging/providers`, headers: H, payload: {
      channel: 'FAX', providerName: 'x', config: {},
    } });
    expect(bad.statusCode).toBe(400);
  }, 60_000);

  it('ciclo: send QUEUED → drain SENT → webhook DELIVERED', async () => {
    const H = { authorization: `Bearer ${adminToken}` };
    const send = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/messaging/send`, headers: H, payload: {
      channel: 'EMAIL', recipient: 'pai@test.com', payload: { subject: 'Boas-vindas', body: 'Olá!' },
    } });
    expect(send.statusCode).toBe(201);
    const d = send.json() as { id: string; status: string };
    expect(d.status).toBe('QUEUED');

    const n = await drainQueue(db.pool, createSandboxAdapter(), 10);
    expect(n).toBeGreaterThanOrEqual(1);

    const wh = await app.inject({ method: 'POST', url: '/v1/messaging/webhook/EMAIL', headers: { 'x-webhook-signature': 'sig-test' }, payload: {
      providerMessageId: `sbx-${d.id}`, status: 'DELIVERED',
    } });
    expect(wh.statusCode).toBe(200);
    expect((wh.json() as { status: string }).status).toBe('DELIVERED');

    const list = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/messaging/deliveries?status=DELIVERED`, headers: H });
    expect(list.statusCode).toBe(200);
    const arr = (list.json() as { deliveries: Array<{ id: string }> }).deliveries;
    expect(arr.some((x) => x.id === d.id)).toBe(true);
  }, 60_000);

  it('opt-out: recusa envio posterior', async () => {
    const H = { authorization: `Bearer ${adminToken}` };
    const oo = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/messaging/opt-out`, headers: H, payload: { channel: 'EMAIL', recipient: 'não@test.com' } });
    expect(oo.statusCode).toBe(204);
    const send = await app.inject({ method: 'POST', url: `/v1/tenants/${tenantId}/messaging/send`, headers: H, payload: { channel: 'EMAIL', recipient: 'não@test.com' } });
    expect(send.statusCode).toBe(201);
    expect((send.json() as { status: string }).status).toBe('OPT_OUT');
  }, 60_000);

  it('webhook sem assinatura → 401; payload incompleto → 400; id desconhecido → 404', async () => {
    const noSig = await app.inject({ method: 'POST', url: '/v1/messaging/webhook/EMAIL', payload: { providerMessageId: 'x', status: 'DELIVERED' } });
    expect(noSig.statusCode).toBe(401);
    const noBody = await app.inject({ method: 'POST', url: '/v1/messaging/webhook/EMAIL', headers: { 'x-webhook-signature': 's' }, payload: { status: 'DELIVERED' } });
    expect(noBody.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'POST', url: '/v1/messaging/webhook/EMAIL', headers: { 'x-webhook-signature': 's' }, payload: { providerMessageId: 'ghost', status: 'DELIVERED' } });
    expect(unknown.statusCode).toBe(404);
  }, 60_000);

  it('FAILED: 3 tentativas de adapter com falha', async () => {
    const d = await enqueueMessage(db.pool, tenantId, { channel: 'SMS', recipient: '+5511900000000' });
    expect(d.status).toBe('QUEUED');
    const failAdapter = { mode: 'live' as const, send: async () => ({ ok: false, providerMessageId: '', error: 'provider down' }) };
    // 3 drenagens: attempts 1, 2, 3 → FAILED
    await drainQueue(db.pool, failAdapter, 10);
    await drainQueue(db.pool, failAdapter, 10);
    await drainQueue(db.pool, failAdapter, 10);
    const H = { authorization: `Bearer ${adminToken}` };
    const list = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/messaging/deliveries?status=FAILED`, headers: H });
    const arr = (list.json() as { deliveries: Array<{ id: string; attempts: number }> }).deliveries;
    const mine = arr.find((x) => x.id === d.id);
    expect(mine?.attempts).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
