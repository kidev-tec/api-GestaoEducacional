/**
 * API HTTP do ERP — Fastify + OpenAPI + Scalar (doc em /docs).
 * Regras: tenant obrigatório por request (X-Tenant-Id em dev; JWT é ADR PROPOSED),
 * erros de domínio mapeados para HTTP sem vazar stacktrace.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifyApiReference from '@scalar/fastify-api-reference';
import cors from '@fastify/cors';
import type { Pool } from 'pg';
import {
  withTransaction,
  postLedger,
  ledgerBalance,
  createEnrollment,
  transitionEnrollment,
  getEnrollment,
  auditCount,
} from '@erp/infra/src/repositories.js';

export interface BuildOptions {
  pool: Pool;
  logger?: boolean;
  /** Origens permitidas para CORS (dev: Vite 5173). */
  corsOrigins?: string[];
}

const TENANT_HEADER = 'x-tenant-id';

/** Mapeia erros de domínio para HTTP status sem vazar stack. */
function mapDomainError(e: unknown): { status: number; message: string } {
  const msg = e instanceof Error ? e.message : 'internal error';
  if (/different payload|conflict/i.test(msg)) return { status: 409, message: msg };
  if (/invalid .* transition/i.test(msg)) return { status: 422, message: msg };
  if (/not found|must reference the original|cannot reverse/i.test(msg)) {
    return { status: 404, message: msg };
  }
  if (/integer cents|denied/i.test(msg)) return { status: 400, message: msg };
  return { status: 500, message: 'internal error' };
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    origin: opts.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'ERP Platform API',
        description: 'API do núcleo ERP — education vertical (matrícula + ledger).',
        version: '0.1.0',
      },
    },
  });

  await app.register(fastifyApiReference, {
    routePrefix: '/docs',
  });

  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request, reply) => {
    // /health e /docs são públicos (sem tenant)
    if (request.url === '/health' || request.url.startsWith('/docs') || request.url === '/openapi.json') {
      return;
    }
    const tenant = request.headers[TENANT_HEADER];
    if (typeof tenant !== 'string' || tenant.length === 0) {
      return reply.status(400).send({ error: `missing ${TENANT_HEADER} header` });
    }
    const known = await opts.pool.query('SELECT id FROM tenants WHERE id = $1', [tenant]);
    if (!known.rowCount) {
      return reply.status(401).send({ error: 'unknown tenant' });
    }
    request.tenantId = tenant;
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'resource not found' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/openapi.json', async (_req, reply) => {
    return reply.send(app.swagger());
  });

  app.post('/v1/enrollments', {
    schema: {
      description: 'Cria matrícula idempotente (Idempotency-Key header)',
      body: {
        type: 'object',
        required: ['studentId', 'offerId'],
        properties: { studentId: { type: 'string' }, offerId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.status(400).send({ error: 'missing idempotency-key header' });
    }
    const body = request.body as { studentId: string; offerId: string };
    try {
      const result = await withTransaction(opts.pool, (c) =>
        createEnrollment(c, {
          id: `enr-${crypto.randomUUID()}`,
          tenantId: request.tenantId,
          studentId: body.studentId,
          offerId: body.offerId,
          idempotencyKey: key,
        }),
      );
      return reply.status(result.idempotentReplay ? 200 : 201).send({
        id: result.enrollment.id,
        state: result.enrollment.state,
        replay: result.idempotentReplay,
      });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/v1/enrollments/:id/transition', {
    schema: {
      description: 'Transiciona estado da matrícula',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['to'],
        properties: {
          to: {
            type: 'string',
            enum: ['DRAFT', 'PENDING_DOCUMENTS', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELED', 'REJECTED'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { to } = request.body as { to: string };
    try {
      const rec = await withTransaction(opts.pool, (c) =>
        transitionEnrollment(c, { id, to: to as never, tenantId: request.tenantId, actorId: 'api' }),
      );
      return reply.send({ id: rec.id, state: rec.state });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/enrollments/:id', {
    schema: {
      description: 'Busca matrícula do tenant',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const rec = await getEnrollment(opts.pool, id, request.tenantId);
      return reply.send({ id: rec.id, state: rec.state });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/v1/ledger/entries', {
    schema: {
      description: 'Lança entrada no ledger (Idempotency-Key header)',
      body: {
        type: 'object',
        required: ['type', 'amountCents'],
        properties: {
          type: { type: 'string', enum: ['CHARGE', 'PAYMENT', 'REVERSAL'] },
          amountCents: { type: 'integer' },
          reverses: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.status(400).send({ error: 'missing idempotency-key header' });
    }
    const body = request.body as { type: 'CHARGE' | 'PAYMENT' | 'REVERSAL'; amountCents: number; reverses?: string };
    try {
      const result = await withTransaction(opts.pool, (c) =>
        postLedger(c, {
          entryId: `led-${crypto.randomUUID()}`,
          tenantId: request.tenantId,
          type: body.type,
          amountCents: body.amountCents,
          ...(body.reverses !== undefined && { reverses: body.reverses }),
          idempotencyKey: key,
        }),
      );
      return reply.status(result.idempotentReplay ? 200 : 201).send({
        id: result.entry.id,
        replay: result.idempotentReplay,
      });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/ledger/balance', async (request) => {
    return { balanceCents: await ledgerBalance(opts.pool, request.tenantId) };
  });

  app.get('/v1/audit/count', async (request) => {
    return { count: await auditCount(opts.pool, request.tenantId) };
  });

  return app;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
  }
}
