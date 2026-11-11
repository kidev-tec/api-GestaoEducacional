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
  insertPlan,
  listPlans,
  generateTuition,
  settleTuition,
  cancelTuition,
  listTuitions,
  getTuition,
  TuitionRuleError,
} from '../../../packages/infra/src/tuition-repositories.js';
import { listOutbox } from '../../../packages/infra/src/outbox-repositories.js';
import { financeIntegrity } from '../../../packages/infra/src/integrity-repositories.js';
import {
  createLead, listLeads, moveLeadStage, LeadRuleError,
  LEAD_STAGES, LEAD_SOURCES, type LeadStage, type LeadSource,
} from '../../../packages/infra/src/lead-repositories.js';
import {
  createStage, renameStage, archiveStage, reorderStages, moveLeadStage as moveLeadToStage,
  getBoard, getMetrics, PipelineError, mapPipelineError,
} from '../../../packages/infra/src/pipeline-repositories.js';
import {
  createTask, completeTask, cancelTask, listTasks, nextInRotation, addToRotation,
  removeFromRotation, getTimeline, getSlaHours, TaskRuleError,
} from '../../../packages/infra/src/task-repositories.js';
import {
  createPriceItem, supersedePriceItem, listActivePriceItems,
  createProposal, transitionProposal, getProposal, listProposals,
  computeSimulation, ProposalRuleError, mapProposalError,
} from '../../../packages/infra/src/proposal-repositories.js';
import { convertProposal, mapConversionError } from '../../../packages/infra/src/proposal-conversion.js';
import {
  createCommissionRule, listCommissionRules, reconcileCommission,
  confirmCredit, listCredits, upsertTarget, targetProgress, mapCommissionError,
} from '../../../packages/infra/src/commission-repositories.js';
import {
  UNLIMITED, assignPlan, countStudents, createCommercialPlan, currentPlan, entitledModules, listCommercialPlans, planLimit, PlanRuleError,
} from '../../../packages/infra/src/plan-repositories.js';

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
  if (e instanceof ConflictError || /different payload|conflict|already linked|already generated/i.test(msg)) return { status: 409, message: msg };
  if (e instanceof NotFoundError || /not found|must reference the original|cannot reverse|parent unit/i.test(msg)) {
    return { status: 404, message: msg };
  }
  if (/integer cents|denied/i.test(msg)) return { status: 400, message: msg };
  if (/consent required for won lead/i.test(msg)) return { status: 403, message: msg };
  if (
    e instanceof UnitCycleError || e instanceof GuardianRuleError || e instanceof TuitionRuleError || e instanceof PlanRuleError || e instanceof LeadRuleError ||
    /invalid .* transition|cycle|depth|inactive|must have kind|cannot be their own|only OPEN can|must exactly match|no charge to reverse|YYYY-MM|must be between|positive integer|must be slug|bad limit|lead is already closed|lost_reason is required|valid email is required|invalid lead source|name is required|phone too long|campaign too long/i.test(msg)
  ) return { status: 422, message: msg };
  if (/consent required for won lead/i.test(msg)) return { status: 403, message: msg };
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
    request.userId = (request as AuthenticatedRequest).user.id;
    request.userRole = (request as AuthenticatedRequest).user.role;
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

  // ─── E03-C: stats do outbox por tenant (read-only) ───
  app.get('/v1/outbox/stats', async (request) => {
    const r = await opts.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed,
         COUNT(*) FILTER (WHERE processed_at IS NULL AND attempts < 5) AS pending,
         COUNT(*) FILTER (WHERE processed_at IS NULL AND attempts >= 5) AS dlq
       FROM outbox_events WHERE tenant_id = $1`,
      [request.tenantId],
    );
    const row = r.rows[0] as { processed: string; pending: string; dlq: string };
    return { pending: Number(row.pending), processed: Number(row.processed), dlq: Number(row.dlq) };
  });

  // ─── E07-B: integridade financeira (RF-01..04) ───
  app.get('/v1/finance/integrity', async (request, reply) => {
    try {
      const report = await financeIntegrity(opts.pool, request.tenantId);
      await opts.pool.query(
        'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
        [request.tenantId, (request as AuthenticatedRequest).user.id ?? 'unknown', 'finance.integrity.run', 'ledger', request.tenantId],
      );
      return reply.send(report);
    } catch (e) {
      app.log.error({ err: e }, 'finance integrity failed');
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  // ─── E06-A: CRM leads + funil (RF-01..05) ───
  const leadStageSchema = { type: 'string', enum: [...LEAD_STAGES] };
  const leadSourceSchema = { type: 'string', enum: [...LEAD_SOURCES] };

  app.post('/v1/leads', { preHandler: [writeGuard], schema: { body: {
    type: 'object', additionalProperties: false, required: ['name', 'email', 'source'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      email: { type: 'string', format: 'email', maxLength: 200 },
      phone: { type: 'string', maxLength: 20 },
      source: leadSourceSchema,
      campaign: { type: 'string', maxLength: 120 },
      consent: { type: 'boolean' },
    },
  } } }, async (request, reply) => {
    try {
      const lead = await createLead(opts.pool, request.tenantId, request.body as Parameters<typeof createLead>[2]);
      return reply.status(201).send(lead);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/leads', { schema: { querystring: {
    type: 'object', additionalProperties: false,
    properties: {
      stage: leadStageSchema,
      source: leadSourceSchema,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
    },
  } } }, async (request) => {
    const q = request.query as { stage?: LeadStage; source?: LeadSource; limit?: number; offset?: number };
    return listLeads(opts.pool, request.tenantId, q);
  });

  app.patch('/v1/leads/:id/stage', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    body: {
      type: 'object', additionalProperties: false, required: ['stage'],
      properties: {
        stage: leadStageSchema,
        lost_reason: { type: 'string', minLength: 3, maxLength: 500 },
      },
    },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { stage: LeadStage; lost_reason?: string };
    try {
      const lead = await withTransaction(opts.pool, (c) =>
        moveLeadStage(c, request.tenantId, id, body.stage, body.lost_reason, (request as AuthenticatedRequest).user.id),
      );
      return reply.send(lead);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

const uuid = { type: 'string' as const, format: 'uuid' as const };
const NAME_MAX = 200;
const str = (max = NAME_MAX) => ({ type: 'string' as const, minLength: 1, maxLength: max });

  // ─── E06-B: funil configurável + Kanban + histórico (RF-01..06) ───
  const stageKindSchema = { type: 'string', enum: ['open', 'won', 'lost'] };

  app.post('/v1/pipelines/default/stages', { preHandler: [writeGuard], schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['label', 'kind'],
      properties: { label: str(100), kind: stageKindSchema, afterPosition: { type: 'integer', minimum: 1 } },
    },
  } }, async (request, reply) => {
    const b = request.body as { label: string; kind: 'open' | 'won' | 'lost'; afterPosition?: number };
    try {
      const stage = await withTransaction(opts.pool, (c) =>
        createStage(c, request.tenantId, b.label, b.kind, b.afterPosition));
      return reply.status(201).send(stage);
    } catch (e) {
      const { status } = mapPipelineError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.patch('/v1/pipelines/default/stages/:id', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
    body: {
      type: 'object', additionalProperties: false,
      properties: { label: str(100), archive: { type: 'boolean' } },
      anyOf: [{ required: ['label'] }, { required: ['archive'] }],
    },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { label?: string; archive?: boolean };
    try {
      await withTransaction(opts.pool, async (c) => {
        const owned = await c.query('SELECT 1 FROM pipeline_stages WHERE id = $1 AND tenant_id = $2', [id, request.tenantId]);
        if (!owned.rowCount) throw new NotFoundError('estágio não encontrado');
        if (b.archive) {
          await archiveStage(c, request.tenantId, id);
          return {};
        }
        if (b.label === undefined) throw new PipelineError('INVALID_REORDER', 'nada a fazer');
        return renameStage(c, request.tenantId, id, b.label);
      });
      return reply.send({ ok: true });
    } catch (e) {
      const { status } = mapPipelineError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.post('/v1/pipelines/default/stages/reorder', { preHandler: [writeGuard], schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['orderedIds'],
      properties: { orderedIds: { type: 'array', items: uuid, minItems: 1 } },
    },
  } }, async (request, reply) => {
    const { orderedIds } = request.body as { orderedIds: string[] };
    try {
      await withTransaction(opts.pool, (c) => reorderStages(c, request.tenantId, orderedIds));
      return reply.send({ ok: true });
    } catch (e) {
      const { status } = mapPipelineError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.post('/v1/leads/:id/move', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
    body: { type: 'object', additionalProperties: false, required: ['toStageId'], properties: { toStageId: uuid } },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { toStageId } = request.body as { toStageId: string };
    try {
      const r = await withTransaction(opts.pool, (c) =>
        moveLeadToStage(c, request.tenantId, id, toStageId, (request as AuthenticatedRequest).user.id));
      return reply.send(r);
    } catch (e) {
      const { status } = mapPipelineError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.get('/v1/pipelines/default/board', async (request) =>
    withTransaction(opts.pool, (c) => getBoard(c, request.tenantId)));

  app.get('/v1/pipelines/default/metrics', async (request) =>
    withTransaction(opts.pool, (c) => getMetrics(c, request.tenantId)));

  // ─── E06-B fim ───

  // ─── E06-C: tarefas follow-up + round-robin + timeline ───
  const mapTaskError = (e: unknown): { status: number } => {
    if (e instanceof TaskRuleError) return { status: 422 };
    const { status } = mapPipelineError(e); // NotFound 404 / Pipeline 409-422 fallback uniforme
    return { status };
  };

  app.post('/v1/crm/tasks', { preHandler: [writeGuard], schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['leadId', 'assignedTo', 'kind', 'dueAt'],
      properties: {
        leadId: uuid, assignedTo: uuid,
        kind: { type: 'string', enum: ['call', 'visit', 'email', 'other'] },
        dueAt: { type: 'string', format: 'date-time' },
        notes: { type: 'string', maxLength: 500 },
      },
    },
  } }, async (request, reply) => {
    const b = request.body as { leadId: string; assignedTo: string; kind: 'call'|'visit'|'email'|'other'; dueAt: string; notes?: string };
    try {
      const task = await withTransaction(opts.pool, (c) => createTask(c, request.tenantId, b));
      return reply.status(201).send(task);
    } catch (e) {
      const { status } = mapTaskError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.post('/v1/crm/tasks/:id/done', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const task = await withTransaction(opts.pool, (c) =>
        completeTask(c, request.tenantId, id, (request as AuthenticatedRequest).user.id));
      return reply.send(task);
    } catch (e) {
      const { status } = mapTaskError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.post('/v1/crm/tasks/:id/cancel', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
    body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str(200) } },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason: string };
    try {
      const task = await withTransaction(opts.pool, (c) =>
        cancelTask(c, request.tenantId, id, reason, (request as AuthenticatedRequest).user.id));
      return reply.send(task);
    } catch (e) {
      const { status } = mapTaskError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.get('/v1/crm/tasks', { schema: { querystring: {
    type: 'object', additionalProperties: false,
    properties: {
      assignedTo: uuid,
      status: { type: 'string', enum: ['open', 'done', 'canceled'] },
      overdue: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      offset: { type: 'integer', minimum: 0 },
    },
  } } }, async (request) => {
    const q = request.query as { assignedTo?: string; status?: 'open'|'done'|'canceled'; overdue?: boolean; limit?: number; offset?: number };
    return withTransaction(opts.pool, (c) => listTasks(c, request.tenantId, q));
  });

  app.post('/v1/crm/rotation', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: uuid } },
  } }, async (request, reply) => {
    const { userId } = request.body as { userId: string };
    await withTransaction(opts.pool, (c) => addToRotation(c, request.tenantId, userId));
    return reply.status(201).send({ ok: true });
  });

  app.delete('/v1/crm/rotation/:userId', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['userId'], properties: { userId: uuid } },
  } }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      await withTransaction(opts.pool, (c) => removeFromRotation(c, request.tenantId, userId));
      return reply.send({ ok: true });
    } catch (e) {
      const { status } = mapTaskError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.post('/v1/crm/rotation/assign', { preHandler: [writeGuard], schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['leadId', 'kind', 'dueAt'],
      properties: { leadId: uuid, kind: { type: 'string', enum: ['call','visit','email','other'] }, dueAt: { type: 'string', format: 'date-time' }, notes: { type: 'string', maxLength: 500 } },
    },
  } }, async (request, reply) => {
    const b = request.body as { leadId: string; kind: 'call'|'visit'|'email'|'other'; dueAt: string; notes?: string };
    try {
      const task = await withTransaction(opts.pool, async (c) => {
        const userId = await nextInRotation(c, request.tenantId);
        return createTask(c, request.tenantId, { ...b, assignedTo: userId });
      });
      return reply.status(201).send(task);
    } catch (e) {
      const { status } = mapTaskError(e);
      if (status === 500) request.log.error(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.get('/v1/leads/:id/timeline', { schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const timeline = await withTransaction(opts.pool, (c) => getTimeline(c, request.tenantId, id));
      return reply.send(timeline);
    } catch (e) {
      const { status } = mapTaskError(e);
      return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' });
    }
  });

  app.get('/v1/crm/sla', async (request) =>
    ({ slaHours: await withTransaction(opts.pool, (c) => getSlaHours(c, request.tenantId)) }));

  // ─── E06-C fim ───

  // ─── E06-04: propostas + tabela de preços versionada ───
  app.get('/v1/price-items', { schema: { querystring: { type: 'object', properties: { active: { type: 'boolean' } } } } },
    async (request) => listActivePriceItems(opts.pool, request.tenantId));

  app.post('/v1/price-items', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['courseName', 'durationMonths', 'priceCents'],
      properties: { courseName: str(200), durationMonths: { type: 'integer', minimum: 1 }, priceCents: { type: 'integer', minimum: 1 }, supersedeId: uuid } },
  } }, async (request, reply) => {
    const b = request.body as { courseName: string; durationMonths: number; priceCents: number; supersedeId?: string };
    try {
      const item = await withTransaction(opts.pool, (c) =>
        b.supersedeId
          ? supersedePriceItem(c, request.tenantId, b.supersedeId, b, request.userId ?? 'api')
          : createPriceItem(c, request.tenantId, b, request.userId ?? 'api'));
      return reply.status(201).send(item);
    } catch (e) { const { status } = mapProposalError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.post('/v1/proposals/simulate', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['priceCents'],
      properties: { priceCents: { type: 'integer', minimum: 1 }, discountCents: { type: 'integer', minimum: 0 }, discountPct: { type: 'number', minimum: 0 } } },
  } }, async (request, reply) => {
    const b = request.body as { priceCents: number; discountCents?: number; discountPct?: number };
    try { return computeSimulation(b.priceCents, b.discountCents ?? 0, b.discountPct ?? null); }
    catch (e) { const { status } = mapProposalError(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.post('/v1/proposals', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['leadId', 'priceItemId'],
      properties: { leadId: uuid, priceItemId: uuid, discountCents: { type: 'integer', minimum: 0 }, discountPct: { type: 'number', minimum: 0 }, validDays: { type: 'integer', minimum: 1 } } },
  } }, async (request, reply) => {
    const b = request.body as { leadId: string; priceItemId: string; discountCents?: number; discountPct?: number; validDays?: number };
    try {
      const p = await withTransaction(opts.pool, (c) => createProposal(c, request.tenantId, { ...b, actor: request.userId ?? 'api' }));
      return reply.status(201).send(p);
    } catch (e) { const { status } = mapProposalError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.post('/v1/proposals/:id/:action', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id', 'action'], properties: { id: uuid, action: { enum: ['approve', 'send', 'accept', 'reject', 'cancel'] } },
    },
    body: { type: 'object', additionalProperties: false, properties: { signedByName: str(200) } },
  } }, async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    const b = (request.body ?? {}) as { signedByName?: string };
    try {
      const toStatus = action === 'approve' ? 'approved' : action === 'accept' ? 'accepted'
        : action === 'reject' ? 'rejected' : action === 'cancel' ? 'canceled' : action === 'send' ? 'sent' : action;
      const p = await withTransaction(opts.pool, (c) => transitionProposal(c, request.tenantId, id, toStatus, request.userId ?? 'api',
        { ...(request.userRole !== undefined ? { approverRole: request.userRole } : {}), ...(b.signedByName !== undefined ? { signedByName: b.signedByName } : {}) }));
      return reply.send(p);
    } catch (e) { const { status } = mapProposalError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.get('/v1/proposals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try { return await getProposal(opts.pool, request.tenantId, id); }
    catch (e) { const { status } = mapProposalError(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.get('/v1/proposals', { schema: { querystring: { type: 'object', properties: { leadId: uuid } } } },
    async (request) => {
      const { leadId } = request.query as { leadId?: string };
      return listProposals(opts.pool, request.tenantId, leadId);
    });
  // ─── E06-04 fim ───

  // ─── E06-05: converter proposta em matrícula ───
  app.post('/v1/proposals/:id/convert', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
    body: { type: 'object', additionalProperties: false, properties: {} },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await withTransaction(opts.pool, (c) => convertProposal(c, request.tenantId, id, request.userId ?? 'api'));
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (e) { const { status } = mapConversionError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });
  // ─── E06-05 fim ───

  // ─── E06-06: comissões + metas comerciais ───
  app.post('/v1/commission-rules', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'value'],
      properties: { name: str(120), kind: { enum: ['PERCENT', 'FLAT'] }, value: { type: 'number' },
        targetUserId: str(120), minTotalCents: { type: 'integer', minimum: 1 }, validFrom: str(10) } },
  } }, async (request, reply) => {
    const b = request.body as { name: string; kind: 'PERCENT' | 'FLAT'; value: number; targetUserId?: string; minTotalCents?: number; validFrom?: string };
    try {
      const rule = await createCommissionRule(opts.pool, request.tenantId, b, request.userId ?? 'api');
      return reply.status(201).send(rule);
    } catch (e) { const { status } = mapCommissionError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.get('/v1/commission-rules', { schema: { querystring: { type: 'object', properties: { active: { type: 'boolean' } } } } },
    async (request) => {
      const { active } = request.query as { active?: boolean };
      return listCommissionRules(opts.pool, request.tenantId, active === true);
    });

  app.post('/v1/commissions/reconcile', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['enrollmentId', 'userId', 'baseCents', 'sourceEvent', 'sourceId'],
      properties: { enrollmentId: str(64), userId: str(120), baseCents: { type: 'integer', minimum: 1 },
        sourceEvent: str(64), sourceId: str(64), reversal: { type: 'boolean' } } },
  } }, async (request, reply) => {
    const b = request.body as { enrollmentId: string; userId: string; baseCents: number; sourceEvent: string; sourceId: string; reversal?: boolean };
    try {
      const result = await withTransaction(opts.pool, (c) => reconcileCommission(c, request.tenantId, {
        enrollmentId: b.enrollmentId, userId: b.userId, baseCents: b.baseCents,
        sourceEvent: b.reversal === true ? 'ledger.reversal' : b.sourceEvent, sourceId: b.sourceId,
      }));
      return reply.send(result);
    } catch (e) { const { status } = mapCommissionError(e); if (status === 500) request.log.error(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.post('/v1/commissions/:id/confirm', { preHandler: [writeGuard], schema: {
    params: { type: 'object', required: ['id'], properties: { id: uuid } },
    body: { type: 'object', additionalProperties: false, properties: {} },
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const credit = await withTransaction(opts.pool, (c) => confirmCredit(c, request.tenantId, id, request.userRole));
      return reply.send(credit);
    } catch (e) { const { status } = mapCommissionError(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });

  app.get('/v1/commissions', { schema: { querystring: { type: 'object', properties: { userId: str(120), status: str(20) } } } },
    async (request) => {
      const q = request.query as { userId?: string; status?: string };
      return listCredits(opts.pool, request.tenantId, q);
    });

  app.put('/v1/commissions/targets', { preHandler: [writeGuard], schema: {
    body: { type: 'object', additionalProperties: false, required: ['userId', 'period', 'amountCents'],
      properties: { userId: str(120), period: str(7), amountCents: { type: 'integer', minimum: 1 } } },
  } }, async (request) => {
    const b = request.body as { userId: string; period: string; amountCents: number };
    return upsertTarget(opts.pool, request.tenantId, b);
  });

  app.get('/v1/commissions/targets/:period', { schema: {
    params: { type: 'object', required: ['period'], properties: { period: str(7) } },
  } }, async (request, reply) => {
    const { period } = request.params as { period: string };
    try { return await targetProgress(opts.pool, request.tenantId, period); }
    catch (e) { const { status } = mapCommissionError(e); return reply.status(status).send({ error: e instanceof Error ? e.message : 'erro' }); }
  });
  // ─── E06-06 fim ───


  // ─── E05-A: unidades, pessoas e responsáveis ───
  app.post('/v1/units', {
    preHandler: [writeGuard],
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: str(120), parentId: uuid } },
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
        type: 'object', additionalProperties: false, required: ['kind', 'name', 'unitId'],
        properties: {
          kind: { type: 'string', enum: ['STUDENT', 'GUARDIAN', 'STAFF'] },
          name: str(), unitId: uuid,
          document: str(64), email: str(320), phone: str(32),
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { kind: PersonRow['kind']; name: string; unitId: string; document?: string; email?: string; phone?: string };
    try {
      // E13-A: enforce max_students do plano vigente (sem plano → UNLIMITED trial, liberado)
      if (body.kind === 'STUDENT') {
        const limit = await planLimit(opts.pool, request.tenantId, 'max_students');
        if (limit !== UNLIMITED) {
          const n = await countStudents(opts.pool, request.tenantId);
          if (n >= limit) {
            return reply.status(403).send({ error: 'plan limit reached for max_students' });
          }
        }
      }
      const person = await withTransaction(opts.pool, (c) => insertPerson(c, { tenantId: request.tenantId, ...body })) as { id: string; kind: PersonRow['kind']; name: string };
      return reply.status(201).send({ id: person.id, kind: person.kind, name: person.name });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/people', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['STUDENT', 'GUARDIAN', 'STAFF'] },
          unitId: uuid, name: str(120),
        },
      },
    },
  }, async (request) => {
    const q = request.query as { kind?: PersonRow['kind']; unitId?: string; name?: string };
    return { people: await listPeople(opts.pool, request.tenantId, { ...(q.kind && { kind: q.kind }), ...(q.unitId && { unitId: q.unitId }), ...(q.name && { nameQuery: q.name }) }) };
  });

  app.get('/v1/people/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
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
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false,
        properties: { name: str(), unitId: uuid, document: { type: ['string', 'null'], maxLength: 64 }, email: { type: ['string', 'null'], maxLength: 320 }, phone: { type: ['string', 'null'], maxLength: 32 }, active: { type: 'boolean' } },
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
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['guardianId', 'relation'], properties: { guardianId: uuid, relation: str(64), isPrimary: { type: 'boolean' } } },
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
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { guardians: await listGuardians(opts.pool, request.tenantId, id) };
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  // ── E07-A: mensalidades ────────────────────────────────────────────────
  const cents = { type: 'integer' as const, minimum: 1, maximum: 100_000_000 };
  const referenceSchema = { type: 'string' as const, pattern: '^\\d{4}-(0[1-9]|1[0-2])$' };

  app.post('/v1/tuition/plans', {
    preHandler: [writeGuard],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'amountCents', 'dueDay'],
        additionalProperties: false,
        properties: { name: str(120), amountCents: cents, dueDay: { type: 'integer', minimum: 1, maximum: 12 } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { name: string; amountCents: number; dueDay: number };
    try {
      const plan = await withTransaction(opts.pool, (c) =>
        insertPlan(c, { tenantId: request.tenantId, name: body.name, amountCents: body.amountCents, dueDay: body.dueDay }),
      );
      return reply.status(201).send(plan);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/tuition/plans', async (_request, reply) => {
    return { plans: await listPlans(opts.pool, _request.tenantId) };
  });

  app.post('/v1/tuition/generate', {
    preHandler: [writeGuard],
    schema: {
      body: {
        type: 'object',
        required: ['planId', 'studentId', 'reference'],
        additionalProperties: false,
        properties: { planId: uuid, studentId: uuid, reference: referenceSchema, dueDate: { type: 'string', format: 'date' } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { planId: string; studentId: string; reference: string; dueDate?: string };
    try {
      const tuition = await withTransaction(opts.pool, (c) =>
        generateTuition(c, { tenantId: request.tenantId, planId: body.planId, studentId: body.studentId, reference: body.reference, ...(body.dueDate !== undefined && { dueDate: body.dueDate }) }),
      );
      return reply.status(201).send(tuition);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/v1/tuition/:id/settle', {
    preHandler: [writeGuard],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object',
        required: ['paymentAmountCents', 'idempotencyKey'],
        additionalProperties: false,
        properties: { paymentAmountCents: cents, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { paymentAmountCents: number; idempotencyKey: string };
    try {
      const result = await withTransaction(opts.pool, (c) =>
        settleTuition(c, { tenantId: request.tenantId, tuitionId: id, paymentAmountCents: body.paymentAmountCents, idempotencyKey: body.idempotencyKey }),
      );
      return reply.status(200).send({ tuition: result.tuition, ledgerEntryId: result.ledgerEntryId });
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/v1/tuition/:id/cancel', {
    preHandler: [writeGuard],
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await withTransaction(opts.pool, (c) => cancelTuition(c, request.tenantId, id)));
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/tuition', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['OPEN', 'SETTLED', 'CANCELED'] },
          studentId: uuid,
          reference: referenceSchema,
        },
      },
    },
  }, async (request) => {
    const q = request.query as { status?: 'OPEN' | 'SETTLED' | 'CANCELED'; studentId?: string; reference?: string };
    return { tuitions: await listTuitions(opts.pool, request.tenantId, q) };
  });

  app.get('/v1/tuition/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await getTuition(opts.pool, request.tenantId, id);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  // E03-A: outbox read-only — observabilidade de eventos (admin/listagem por sessão)
  app.get('/v1/outbox', {
    schema: {
      querystring: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['pending', 'processed', 'dlq'] } },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const q = request.query as { status?: 'pending' | 'processed' | 'dlq' };
    return { events: await listOutbox(opts.pool, request.tenantId, q) };
  });

  // ── E13-A: planos comerciais + entitlements ──────────────────────────────
  app.post('/v1/plans', {
    preHandler: [writeGuard],
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['code', 'name', 'priceCents'],
        properties: {
          code: { type: 'string', pattern: '^[a-z0-9-]{2,32}$' },
          name: { type: 'string', minLength: 1, maxLength: 120 },
          priceCents: { type: 'integer', minimum: 0 },
          modules: { type: 'array', items: { type: 'string', pattern: '^[a-z_]{2,20}$' } },
          limits: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: -1 },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { code: string; name: string; priceCents: number; modules?: string[]; limits?: Record<string, number> };
    try {
      const plan = await createCommercialPlan(opts.pool, body);
      return reply.status(201).send(plan);
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  app.get('/v1/plans', {}, async () => ({ plans: await listCommercialPlans(opts.pool) }));

  app.get('/v1/plans/current', {}, async (request) => {
    const plan = await currentPlan(opts.pool, request.tenantId);
    if (!plan) return { plan: null, modules: await entitledModules(opts.pool, request.tenantId) };
    return { plan: { id: plan.id, code: plan.code, name: plan.name, priceCents: plan.priceCents }, modules: await entitledModules(opts.pool, request.tenantId) };
  });

  app.post('/v1/tenants/:id/plan', {
    preHandler: [writeGuard],
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['planId'],
        properties: { planId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { planId } = request.body as { planId: string };
    if (id !== request.tenantId) return reply.status(404).send({ error: 'not found' }); // cross-tenant
    try {
      await withTransaction(opts.pool, (c) => assignPlan(c, request.tenantId, planId));
      return reply.status(204).send();
    } catch (e) {
      const { status, message } = mapDomainError(e);
      return reply.status(status).send({ error: message });
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    requestId: string;
    userId?: string;
    userRole?: string;
  }
}
