/**
 * RF-018/RF-019 — G7: /ready contra Postgres real, request-id middleware,
 * logs seguros. Usa testcontainers (como api.e2e) para exercitar o app
 * completo e manter o gate de cobertura 100×4.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, type TestDb } from '@erp/infra/src/test-db.js';
import { buildApp, mapDomainError, resetLoginLimiter } from '../src/app.js';
import { isUuid, safeLogLine, resolveRequestId } from '../src/obs.js';

let db: TestDb;
let app: FastifyInstance;
let readyToken: string;
const sink: string[] = [];

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool, logSink: (line) => sink.push(line) });
  resetLoginLimiter();
  await app.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: { tenantId: 'A', email: 'ready@test', password: 'correct-horse-123' },
  });
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: 'ready@test', password: 'correct-horse-123' },
  });
  readyToken = (login.json() as { token: string }).token;
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.teardown();
}, 120_000);

describe('obs (RF-018 unidade)', () => {
  it('isUuid valida apenas UUIDs bem formados', () => {
    expect(isUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('resolveRequestId aceita UUID válido e gera outro caso contrário', () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(resolveRequestId(id)).toBe(id);
    expect(isUuid(resolveRequestId("evil'; DROP--"))).toBe(true);
    expect(isUuid(resolveRequestId(undefined))).toBe(true);
  });

  it('safeLogLine: só campos permitidos, sem tenant vazio, trunca route', () => {
    const line = JSON.parse(safeLogLine({
      requestId: 'r1', tenantId: 't', method: 'POST', route: '/x', status: 201, durationMs: 3,
    }));
    expect(Object.keys(line).sort()).toEqual(
      ['durationMs', 'method', 'requestId', 'route', 'status', 'tenantId'].sort(),
    );
    const noTenant = JSON.parse(safeLogLine({
      requestId: 'r1', tenantId: '', method: 'GET', route: '/health', status: 200, durationMs: 1,
    }));
    expect(noTenant).not.toHaveProperty('tenantId');
    const dirty = safeLogLine({
      requestId: 'r1', tenantId: '', method: 'GET', route: '/' + 'a'.repeat(300),
      status: 200, durationMs: 1, body: { studentId: 'x' }, secret: 'shh',
    } as never);
    const parsed = JSON.parse(dirty);
    expect(parsed.route.length).toBeLessThanOrEqual(120);
    expect(parsed).not.toHaveProperty('body');
    expect(parsed).not.toHaveProperty('secret');
  });

  it('tenant não-canônico vira [redacted] (log injection via header bloqueado)', () => {
    for (const evil of ["a'; DROP--", 'tenant\ninjetado', '<script>', 'x'.repeat(200)]) {
      const line = JSON.parse(safeLogLine({
        requestId: 'r1', tenantId: evil, method: 'GET', route: '/x', status: 200, durationMs: 1,
      }));
      expect(line.tenantId).toBe('[redacted]');
    }
    const ok = JSON.parse(safeLogLine({
      requestId: 'r1', tenantId: 'tenant-a', method: 'GET', route: '/x', status: 200, durationMs: 1,
    }));
    expect(ok.tenantId).toBe('tenant-a');
  });
});

describe('GET /ready (RF-019, Postgres real)', () => {
  it('200 {"status":"ready"} com DB no ar', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('/ready sem tenant header não cai no guard (é público)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).not.toBe(400);
  });
});

describe('request-id middleware (RF-018)', () => {
  it('repete x-request-id UUID válido enviado pelo cliente', async () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': id } });
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('gera UUID e NÃO ecoa header malicioso', async () => {
    const evil = 'not-a-uuid';
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': evil } });
    const echoed = String(res.headers['x-request-id']);
    expect(echoed).not.toBe(evil);
    expect(isUuid(echoed)).toBe(true);
  });
});

describe('logging seguro (RF-018)', () => {
  it('linha contém requestId/tenant/route/status e NUNCA body/idempotency/PII', async () => {
    sink.length = 0;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ledger/balance',
      headers: { authorization: `Bearer ${readyToken}`, 'x-request-id': 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
    });
    expect(res.statusCode).toBe(200);
    expect(sink.length).toBeGreaterThan(0);
    const logged = sink.join('\n');
    expect(logged).toContain('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(logged).toContain('/v1/ledger/balance');
    expect(logged).not.toMatch(/idempotency/i);
    expect(logged).not.toContain('password');
    // JSON válido em todas as linhas
    for (const line of sink) expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe('cobertura de ramos remanescentes (reforço G7)', () => {
  it('/ready → 503 quando o pool falha (app isolado com pool quebrado)', async () => {
    const brokenPool = { query: () => Promise.reject(new Error('boom secret-host')) } as never;
    const brokenApp = await buildApp({ pool: brokenPool });
    const res = await brokenApp.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', error: 'database unavailable' });
    expect(res.body).not.toContain('secret-host');
    await brokenApp.close();
  });

  it('REVERSAL apontando para entrada inexistente → 404 sem stack (catch do ledger)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H2('A', { 'idempotency-key': 'rev-ghost' }),
      payload: { type: 'REVERSAL', amountCents: -100, reverses: 'led-ghost-000' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('.ts:');
  });

  it('GET /v1/audit/count retorna número (rota audit)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/audit/count', headers: H2('A') });
    expect(res.statusCode).toBe(200);
    expect(typeof (res.json() as { count: number }).count).toBe('number');
  });

  it('ledger sem idempotency-key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H2('A'),
      payload: { type: 'CHARGE', amountCents: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'missing idempotency-key header' });
  });

  it('ledger com reverses → 201 (branch reverses presente)', async () => {
    const original = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H2('A', { 'idempotency-key': 'rev-orig' }),
      payload: { type: 'CHARGE', amountCents: 500 },
    });
    expect(original.statusCode).toBe(201);
    const origId = (original.json() as { id: string }).id;

    const reversal = await app.inject({
      method: 'POST',
      url: '/v1/ledger/entries',
      headers: H2('A', { 'idempotency-key': 'rev-back' }),
      payload: { type: 'REVERSAL', amountCents: -500, reverses: origId },
    });
    expect(reversal.statusCode).toBe(201);
  });

  it('mapDomainError: erro não mapeado → 500 "internal error" sem stack', () => {
    const res = mapDomainError(new Error('totally unexpected pg panic'));
    expect(res).toEqual({ status: 500, message: 'internal error' });
    expect(res.message).not.toContain('panic');
  });

  it('mapDomainError: centavos/deny → 400 e não-Error → 500', () => {
    expect(mapDomainError(new Error('Money must be integer cents'))).toEqual({
      status: 400,
      message: 'Money must be integer cents',
    });
    expect(mapDomainError(new Error('denied for role'))).toMatchObject({ status: 400 });
    expect(mapDomainError('string error')).toEqual({ status: 500, message: 'internal error' });
  });

  it('onResponse loga com request.url quando routeOptions.url é indefinido', async () => {
    sink.length = 0;
    // rota not-found (routeOptions.url não definida para 404 handler) cai no fallback ?? request.url
    await app.inject({ method: 'GET', url: '/v1/admin/nao-existe', headers: H2('A') });
    expect(sink.length).toBeGreaterThan(0);
    expect(sink.some((l) => l.includes('/v1/admin/nao-existe'))).toBe(true);
  });
});

function H2(tenant: string, extra: Record<string, string> = {}) {
  void tenant; // tenant agora deriva da sessão (E04-A); header mantido só p/ compat de testes antigos
  return { authorization: `Bearer ${readyToken}`, ...extra };
}
