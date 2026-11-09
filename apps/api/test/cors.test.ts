/**
 * QA CORS (finding MEDIUM review G6a): preflight allow/deny contra app real injetado.
 * Sem rede — fastify.inject. Reusa testcontainers como o e2e.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, type TestDb } from '@erp/infra/src/test-db.js';
import { buildApp } from '../src/app.js';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.teardown();
});

describe('CORS allowlist (review G6a)', () => {
  it('preflight de origem permitida é aceito com eco da origem', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/enrollments',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-tenant-id,idempotency-key',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
  });

  it('preflight de origem DESCONHECIDA não recebe allow-origin (negado)', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/enrollments',
      headers: {
        origin: 'https://malicioso.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('127.0.0.1:5173 também é permitido (dev local)', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

  it('origem "null" não vira curinga', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/ledger/balance',
      headers: { origin: 'null', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
