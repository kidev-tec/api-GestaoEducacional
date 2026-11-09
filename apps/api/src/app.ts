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

import {
  resolveRequestId,
  safeLogLine,
} from './obs.js';
import {
  loginUser,
  logoutUser,
  registerUser,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from './auth.js';
import { EmailTakenError, SessionInvalidError } from '../../../packages/infra/src/auth-repositories.js';
import {
  getPerson,
  insertPerson,
  ConflictError,
  GuardianRuleError,
  NotFoundError,
  UnitCycleError,
  insertUnit,
  linkGuardian,
  listGuardians,
  listPeople,
  listUnits,
  updatePerson,
  type PersonRow,
} from '../../../packages/infra/src/people-repositories.js';

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_ATTEMPTS_PER_WINDOW = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= LOGIN_ATTEMPTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

/** Reset do limiter em memória (uso: testes de integração e administrador). */
export function resetLoginLimiter(): void {
  loginAttempts.clear();
}

export interface BuildOptions {
  pool: Pool;
  logger?: boolean;
  /** Origens permitidas para CORS (dev: Vite 5173). */
  corsOrigins?: string[];
  /** RF-018: destino das linhas de log seguras (testes injetam sink). */
  logSink?: (line: string) => void;
}

const TENANT_HEADER = 'x-tenant-id';

/** Mapeia erros de domínio para HTTP status sem vazar stack. */
export function mapDomainError(e: unknown): { status: number; message: string } {
  const msg = e instanceof Error ? e.message : 'internal error';
  if (e instanceof ConflictError || /different payload|conflict|already linked/i.test(msg)) return { status: 409, message: msg };
  if (e instanceof NotFoundError || /not found|must reference the original|cannot reverse|parent unit/i.test(msg)) {
    return { status: 404, message: msg };
  }
  if (e instanceof UnitCycleError || e instanceof GuardianRuleError || /invalid .* transition|cycle|depth|inactive|must have kind|cannot be their own/i.test(msg)) return { status: 422, message: msg };
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
  app.decorateRequest('requestId', '');
  app.decorateRequest('user', null);

  // RF-018: request-id sempre presente (UUID válido aceito, senão gerado).
  app.addHook('onRequest', async (request, reply) => {
    request.requestId = resolveRequestId(request.headers['x-request-id'] as string | undefined);
    reply.header('x-request-id', request.requestId);
  });

  // RF-019: readiness real contra o Postgres (200 ready / 503 sem stack).
  app.get('/ready', async (_request, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return reply.send({ status: 'ready' });
    } catch {
      return reply.status(503).send({ status: 'unavailable', error: 'database unavailable' });
    }
  });

  // RF-018: log seguro por request — só requestId/tenant/method/route/status/duration.
  app.addHook('onResponse', async (request, reply) => {
    opts.logSink?.(
      safeLogLine({
        requestId: request.requestId,
        tenantId: request.tenantId,
        method: request.method,
        route: request.routeOptions?.url ?? request.url,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      }),
    );
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    // Superfícies públicas: health/docs e auth. Demais rotas só via sessão.
    if (path === '/health' || path === '/ready' || path.startsWith('/docs') || path === '/openapi.json' || path.startsWith('/v1/auth/')) return;
    await requireAuth(opts.pool, request, reply);
    if (reply.sent) return;
    request.tenantId = (request as AuthenticatedRequest).user.tenantId;
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'resource not found' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // E04-A review: registro é ADMIN-ONLY (SPEC §4) — sem auto-registro público.
  app.post('/v1/auth/register', {
    preHandler: [async (request, reply) => {
      await requireAuth(opts.pool, request, reply);
      if (reply.sent) return;
      await requireRole('admin')(request, reply);
    }],
  }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string; role?: 'admin' | 'operator' | 'viewer' };
    const role = body.role ?? 'viewer';
    if (!body.email || !body.password || !['admin', 'operator', 'viewer'].includes(role)) {
      return reply.status(400).send({ error: 'invalid registration' });
    }
    try {
      // tenant do novo usuário = tenant do admin criador (sessão), nunca do body
      const user = await registerUser(opts.pool, {
        tenantId: (request as AuthenticatedRequest).user.tenantId, email: body.email, password: body.password, role,
      });
      return reply.status(201).send({ userId: user.id });
    } catch (error) {
      if (error instanceof EmailTakenError || error instanceof Error) return reply.status(400).send({ error: 'invalid registration' });
      throw error;
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    if (!loginAllowed(request.ip)) return reply.status(429).send({ error: 'too many requests' });
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) return reply.status(401).send({ error: 'unauthorized' });
    try {
      return reply.send(await loginUser(opts.pool, body.email, body.password));
    } catch (error) {
      if (error instanceof SessionInvalidError) return reply.status(401).send({ error: 'unauthorized' });
      throw error;
    }
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    await requireAuth(opts.pool, request, reply);
    if (reply.sent) return;
    await logoutUser(opts.pool, request);
    return reply.status(204).send();
  });

  app.get('/v1/auth/me', async (request, reply) => {
    await requireAuth(opts.pool, request, reply);
    if (reply.sent) return;
    return reply.send({ user: (request as AuthenticatedRequest).user });
  });

  app.get('/openapi.json', async (_req, reply) => {
    return reply.send(app.swagger());
  });

  const writeGuard = requireRole('admin', 'operator');

  app.post('/v1/enrollments', {
    preHandler: [writeGuard],
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
    preHandler: [writeGuard],
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
    preHandler: [writeGuard],
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

  // ─── E05-A: unidades, pessoas e responsáveis ───
  app.post('/v1/units', {
    preHandler: [writeGuard],
    schema: {
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const body = request.body as { name: string; parentId?: string };
    try {
      const unit = await withTransaction(opts.pool, (c) =>
        insertUnit(c, { tenantId: request.tenantId, name: body.name, ...(body.parentId !== undefined && { parentId: body.parentId }) }),
      ) as { id: string; name: string; parentId: string | null };
      return reply.status(201).send({ id: unit.id, name: unit.name, parentId: unit.parentId });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/units', async (request) => {
    return { units: await listUnits(opts.pool, request.tenantId) };
  });

  app.post('/v1/people', {
    preHandler: [writeGuard],
    schema: {
      body: {
        type: 'object', required: ['kind', 'name', 'unitId'],
        properties: {
          kind: { type: 'string', enum: ['STUDENT', 'GUARDIAN', 'STAFF'] },
          name: { type: 'string' }, unitId: { type: 'string' },
          document: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { kind: PersonRow['kind']; name: string; unitId: string; document?: string; email?: string; phone?: string };
    try {
      const person = await withTransaction(opts.pool, (c) => insertPerson(c, { tenantId: request.tenantId, ...body })) as { id: string; kind: PersonRow['kind']; name: string };
      return reply.status(201).send({ id: person.id, kind: person.kind, name: person.name });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/people', async (request, reply) => {
    const q = request.query as { kind?: string; unitId?: string; name?: string };
    const kind = q.kind === 'STUDENT' || q.kind === 'GUARDIAN' || q.kind === 'STAFF' ? q.kind : undefined;
    return { people: await listPeople(opts.pool, request.tenantId, { ...(kind && { kind }), ...(q.unitId && { unitId: q.unitId }), ...(q.name && { nameQuery: q.name }) }) };
  });

  app.get('/v1/people/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const person = await getPerson(opts.pool, request.tenantId, id);
      return reply.send({ id: person.id, kind: person.kind, name: person.name, active: person.active, unitId: person.unitId });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.patch('/v1/people/:id', {
    preHandler: [writeGuard],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, unitId: { type: 'string' }, document: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, active: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Parameters<typeof updatePerson>[3];
    try {
      const person = await withTransaction(opts.pool, (c) => updatePerson(c, request.tenantId, id, body)) as { id: string; name: string; active: boolean; unitId: string };
      return reply.send({ id: person.id, name: person.name, active: person.active, unitId: person.unitId });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/v1/people/:id/guardians', {
    preHandler: [writeGuard],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['guardianId', 'relation'], properties: { guardianId: { type: 'string' }, relation: { type: 'string' }, isPrimary: { type: 'boolean' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { guardianId: string; relation: string; isPrimary?: boolean };
    try {
      await withTransaction(opts.pool, (c) =>
        linkGuardian(c, { tenantId: request.tenantId, studentId: id, guardianId: body.guardianId, relation: body.relation, ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary }) }),
      );
      return reply.status(201).send({ linked: true });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/people/:id/guardians', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request) => {
    const { id } = request.params as { id: string };
    return { guardians: await listGuardians(opts.pool, request.tenantId, id) };
  });

  return app;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    requestId: string;
  }
}
