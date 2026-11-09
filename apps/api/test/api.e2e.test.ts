/**
 * G5 — E2E da API HTTP real (Fastify inject) contra Postgres testcontainers.
 * Contrato: tenant obrigatório, erros de domínio → HTTP status, idempotência end-to-end,
 * adversarial HTTP (forjar tenant, replay paralelo, malformado, 404 sem vazamento).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, type TestDb } from '@erp/infra/src/test-db.js';
import { buildApp } from '../src/app.js';

let db: TestDb;
let app: FastifyInstance;

const H = (tenant: string, extra: Record<string, string> = {}) => ({
  'x-tenant-id': tenant,
  ...extra,
});

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.teardown();
}, 120_000);

describe('health & docs', () => {
  it('GET /health sem tenant funciona (público)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /docs serve a referência Scalar (segue redirect p/ /docs/)', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 301, 302]).toContain(res.statusCode);
    const final = res.statusCode === 200
      ? res
      : await app.inject({ method: 'GET', url: res.headers.location as string });
    expect(final.statusCode).toBe(200);
    expect(final.headers['content-type']).toContain('text/html');
  });

  it('GET /openapi.json contém todas as rotas (QG-4 contrato)', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/v1/enrollments',
        '/v1/enrollments/{id}/transition',
        '/v1/enrollments/{id}',
        '/v1/ledger/entries',
        '/v1/ledger/balance',
        '/v1/audit/count',
      ]),
    );
  });
});

describe('tenant guard', () => {
  it('sem header X-Tenant-Id → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ledger/balance' });
    expect(res.statusCode).toBe(400);
  });

  it('tenant inexistente → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: H('ghost') });
    expect(res.statusCode).toBe(401);
  });
});

describe('enrollments via HTTP', () => {
  it('ciclo completo: cria → replay 200 mesmo recurso → transição → consulta', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A', { 'idempotency-key': 'e2e-1' }),
      payload: { studentId: 'stu-1', offerId: 'off-1' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; state: string; replay: boolean };
    expect(created.state).toBe('DRAFT');
    expect(created.replay).toBe(false);

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A', { 'idempotency-key': 'e2e-1' }),
      payload: { studentId: 'stu-1', offerId: 'off-1' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ id: created.id, state: 'DRAFT', replay: true });

    const sameKeyDiffPayload = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A', { 'idempotency-key': 'e2e-1' }),
      payload: { studentId: 'stu-OUTRO', offerId: 'off-1' },
    });
    expect(sameKeyDiffPayload.statusCode).toBe(409);

    const transition = await app.inject({
      method: 'POST',
      url: `/v1/enrollments/${created.id}/transition`,
      headers: H('A'),
      payload: { to: 'PENDING_DOCUMENTS' },
    });
    expect(transition.statusCode).toBe(200);
    expect(transition.json()).toEqual({ id: created.id, state: 'PENDING_DOCUMENTS' });

    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/enrollments/${created.id}/transition`,
      headers: H('A'),
      payload: { to: 'COMPLETED' }, // PENDING_DOCUMENTS → COMPLETED é inválido
    });
    expect(invalid.statusCode).toBe(422);

    const get = await app.inject({
      method: 'GET',
      url: `/v1/enrollments/${created.id}`,
      headers: H('A'),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ id: created.id, state: 'PENDING_DOCUMENTS' });
  });

  it('sem idempotency-key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A'),
      payload: { studentId: 's', offerId: 'o' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('payload malformado → 400 sem stacktrace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A', { 'idempotency-key': 'mal-1' }),
      payload: { naoTemOsCampos: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('at ');
    expect(res.body).not.toContain('.ts:');
  });

  it('enum inválido no body → 400 (validação do schema)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/enrollments/enr-x/transition',
      headers: H('A'),
      payload: { to: 'HACKED' },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});

describe('ledger via HTTP', () => {
  it('webhook replay 3× → 1 lançamento, saldo estável', async () => {
    const b1 = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: H('B') });
    const before = (b1.json() as { balanceCents: number }).balanceCents;

    const first = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H('B', { 'idempotency-key': 'wh-e2e' }),
      payload: { type: 'PAYMENT', amountCents: 4400 },
    });
    expect(first.statusCode).toBe(201);
    const entryId = (first.json() as { id: string }).id;

    for (let i = 0; i < 2; i++) {
      const retry = await app.inject({
        method: 'POST',
        url: '/v1/ledger/entries',
        headers: H('B', { 'idempotency-key': 'wh-e2e' }),
        payload: { type: 'PAYMENT', amountCents: 4400 },
      });
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as { id: string }).id).toBe(entryId);
    }

    const b2 = await app.inject({ method: 'GET', url: '/v1/ledger/balance', headers: H('B') });
    expect((b2.json() as { balanceCents: number }).balanceCents).toBe(before + 4400);
  });

  it('float no amountCents → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H('B', { 'idempotency-key': 'float-1' }),
      payload: { type: 'CHARGE', amountCents: 10.5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('adversarial HTTP', () => {
  it('tenant B não enxerga recurso do tenant A (404 sem vazar)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: H('A', { 'idempotency-key': 'sec-1' }),
      payload: { studentId: 'sec-stu', offerId: 'sec-off' },
    });
    const id = (create.json() as { id: string }).id;

    const stolen = await app.inject({
      method: 'GET',
      url: `/v1/enrollments/${id}`,
      headers: H('B'),
    });
    expect(stolen.statusCode).toBe(404);
    expect(stolen.body).not.toContain('sec-stu');

    const stolenTransition = await app.inject({
      method: 'POST',
      url: `/v1/enrollments/${id}/transition`,
      headers: H('B'),
      payload: { to: 'CANCELED' },
    });
    expect(stolenTransition.statusCode).toBe(404);

    // dono continua enxergando
    const owner = await app.inject({ method: 'GET', url: `/v1/enrollments/${id}`, headers: H('A') });
    expect(owner.statusCode).toBe(200);
  });

  it('2 requests PARALELAS mesmo idempotency-key → 1 recurso criado + 1 replay/conflito', async () => {
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/ledger/entries',
        headers: H('B', { 'idempotency-key': 'parallel-http' }),
        payload: { type: 'CHARGE', amountCents: 777 },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/ledger/entries',
        headers: H('B', { 'idempotency-key': 'parallel-http' }),
        payload: { type: 'CHARGE', amountCents: 777 },
      }),
    ]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    // um 201 (criou), um 200 (replay) — ou um criou e outro 409; nunca 2x201
    expect(statuses).not.toEqual([201, 201]);
    const ids = new Set([r1, r2].filter((r) => r.statusCode !== 409).map((r) => (r.json() as { id: string }).id));
    expect(ids.size).toBe(1);
  });

  it('rota inexistente → 404 genérico sem vazar estrutura', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/internal/secret',
      headers: H('A'),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'resource not found' });
  });

  it('método errado em rota existente → 404/405 sem stack', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/ledger/balance', headers: H('A') });
    expect([404, 405]).toContain(res.statusCode);
    expect(res.body).not.toContain('.ts:');
  });

  it('mesma key entre tenants por HTTP: independente (escopo por tenant)', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H('A', { 'idempotency-key': 'multi-tenant' }),
      payload: { type: 'CHARGE', amountCents: 300 },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H('B', { 'idempotency-key': 'multi-tenant' }),
      payload: { type: 'CHARGE', amountCents: 300 },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect((a.json() as { id: string }).id).not.toBe((b.json() as { id: string }).id);
  });
});
