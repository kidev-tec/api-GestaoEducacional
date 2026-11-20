/**
 * E06-CONTRACT — E2E HTTP: contrato escolar gera títulos a partir da matrícula.
 * Cobre: criação, validações, RBAC, idempotência, ativação→installments,
 * cancel→REVERSAL nas OPEN, isolamento cross-tenant, ghost 404.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, resetLoginLimiter } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let operatorA = '';
let viewerA = '';
let operatorB = '';

const H = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
  resetLoginLimiter();
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  const seed = async (email: string, tenant: string, role: 'operator' | 'viewer') => {
    await db.pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [randomUUID(), tenant, email, hash, role],
    );
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
    return (login.json() as { token: string }).token;
  };
  operatorA = await seed('t06-ops-a@test', 'A', 'operator');
  viewerA = await seed('t06-view-a@test', 'A', 'viewer');
  operatorB = await seed('t06-ops-b@test', 'B', 'operator');
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

let enrollmentId = '';
let planId = '';
let contractId = '';
let classId = '';

async function seedActiveEnrollmentWithPlan() {
  const u = randomUUID().slice(0, 8);
  const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: `Unid E06 ${u}` } });
  const unitId = (unit.json() as { id: string }).id;
  const course = await app.inject({ method: 'POST', url: '/v1/courses', headers: H(operatorA), payload: { name: `Curso E06 ${u}` } });
  const courseId = (course.json() as { id: string }).id;
  const klass = await app.inject({ method: 'POST', url: '/v1/classes', headers: H(operatorA), payload: { courseId, unitId, name: `Turma E06 ${u}`, capacity: 30 } });
  const classId = (klass.json() as { id: string }).id;
  const person = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: `Aluno Contrato ${u}`, unitId } });
  const studentId = (person.json() as { id: string }).id;
  const offer = await app.inject({ method: 'POST', url: '/v1/offers', headers: H(operatorA), payload: { classId, name: `Offer E06 ${u}`, priceCents: 42000 } });
  const offerId = (offer.json() as { id: string }).id;
  const enr = await app.inject({ method: 'POST', url: '/v1/enrollments', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { studentId, offerId } });
  const enrId = (enr.json() as { id: string }).id;
  // leva até ACTIVE pelas transições permitidas
  const transitions = ['DRAFT→PENDING_DOCUMENTS', 'PENDING_DOCUMENTS→PENDING_APPROVAL', 'PENDING_APPROVAL→ACTIVE'];
  for (const t of transitions) {
    const to = t.split('→')[1];
    const r = await app.inject({ method: 'POST', url: `/v1/enrollments/${enrId}/transition`, headers: H(operatorA), payload: { to } });
    if (r.statusCode !== 200) throw new Error(`transition ${to}: ${r.statusCode} ${JSON.stringify(r.body)}`);
  }
  const plan = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: H(operatorA), payload: { name: `Plano E06 ${u}`, amountCents: 42000, dueDay: 10 } });
  return { enrollmentId: enrId, planId: (plan.json() as { id: string }).id, studentId, classId };
}

describe('E06 school contracts', () => {
  it('viewer não cria contrato (403)', async () => {
    const forbidden = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(viewerA), 'idempotency-key': randomUUID() }, payload: { enrollmentId: 'enr-x', planId: '00000000-0000-4000-8000-000000000001', monthlyPriceCents: 100, installments: 1, startReference: '2026-03' } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('validação: price 0 / installments 0 e 13 / reference inválida → 400', async () => {
    const base = { enrollmentId: 'enr-x', planId: '00000000-0000-4000-8000-000000000001', startReference: '2026-03' };
    const mk = (over: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { ...base, monthlyPriceCents: 100, installments: 1, ...over } });
    expect((await mk({ monthlyPriceCents: 0 })).statusCode).toBe(400);
    expect((await mk({ installments: 0 })).statusCode).toBe(400);
    expect((await mk({ installments: 13 })).statusCode).toBe(400);
    expect((await mk({ startReference: '2026/03' })).statusCode).toBe(400);
  });

  it('enrollment/plan ghost → 404', async () => {
    const seed = await seedActiveEnrollmentWithPlan();
    enrollmentId = seed.enrollmentId; planId = seed.planId; classId = seed.classId;
    const mk = (over: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { enrollmentId: seed.enrollmentId, planId: seed.planId, monthlyPriceCents: 42000, installments: 3, startReference: '2026-03', ...over } });
    expect((await mk({ enrollmentId: 'enr-ghost' })).statusCode).toBe(404);
    expect((await mk({ planId: '00000000-0000-4000-8000-000000000099' })).statusCode).toBe(404);
  });

  it('cria DRAFT idempotente; replay 200; key repetida com payload ≠ → 409', async () => {
    const key = randomUUID();
    const payload = { enrollmentId, planId, monthlyPriceCents: 42000, installments: 3, startReference: '2026-03' };
    const first = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': key }, payload });
    expect(first.statusCode, first.body).toBe(201);
    const c = first.json() as { contract: { id: string; status: string } };
    expect(c.contract.status).toBe('DRAFT');
    contractId = c.contract.id;

    const replay = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': key }, payload });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { contract: { id: string } }).contract.id).toBe(contractId);

    const conflict = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': key }, payload: { ...payload, installments: 4 } });
    expect(conflict.statusCode).toBe(409);
  });

  it('enrollment não-ACTIVE → 422', async () => {
    // nova matrícula fica em DRAFT; reutiliza turma do seed anterior
    const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Unid E06b' } });
    const unitId = (unit.json() as { id: string }).id;
    const person = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: 'Aluno Draft', unitId } });
    const offer = await app.inject({ method: 'POST', url: '/v1/offers', headers: H(operatorA), payload: { classId, name: 'Offer E06b', priceCents: 42000 } });
    const enr = await app.inject({ method: 'POST', url: '/v1/enrollments', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { studentId: (person.json() as { id: string }).id, offerId: (offer.json() as { id: string }).id } });
    const r = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { enrollmentId: (enr.json() as { id: string }).id, planId, monthlyPriceCents: 42000, installments: 1, startReference: '2026-03' } });
    expect(r.statusCode).toBe(422);
  });

  it('ativação gera installments títulos com referências consecutivas; re-ativação → 422', async () => {
    const act = await app.inject({ method: 'POST', url: `/v1/contracts/${contractId}/activate`, headers: H(operatorA) });
    expect(act.statusCode, act.body).toBe(200);
    const body = act.json() as { contract: { status: string }; tuitions: { reference: string; amountCents: number; status: string }[] };
    expect(body.contract.status).toBe('ACTIVE');
    expect(body.tuitions).toHaveLength(3);
    expect(body.tuitions.map((t) => t.reference)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(body.tuitions.every((t) => t.amountCents === 42000 && t.status === 'OPEN')).toBe(true);

    const again = await app.inject({ method: 'POST', url: `/v1/contracts/${contractId}/activate`, headers: H(operatorA) });
    expect(again.statusCode).toBe(422);
  });

  it('cancel espelha REVERSAL nas OPEN e marca CANCELED; duplo cancel → 422', async () => {
    const before = await db.pool.query("SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger_entries WHERE tenant_id='A' AND type='REVERSAL'");
    const cancel = await app.inject({ method: 'POST', url: `/v1/contracts/${contractId}/cancel`, headers: H(operatorA) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((cancel.json() as { contract: { status: string } }).contract.status).toBe('CANCELED');
    const after = await db.pool.query("SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger_entries WHERE tenant_id='A' AND type='REVERSAL'");
    expect(Number(after.rows[0].s) - Number(before.rows[0].s)).toBe(-3 * 42000);

    const twice = await app.inject({ method: 'POST', url: `/v1/contracts/${contractId}/cancel`, headers: H(operatorA) });
    expect(twice.statusCode).toBe(422);
  });

  it('isolamento cross-tenant: B não lê/ativa/cancela contrato de A → 404', async () => {
    const seed2 = await seedActiveEnrollmentWithPlan();
    const c2 = await app.inject({ method: 'POST', url: '/v1/contracts', headers: { ...H(operatorA), 'idempotency-key': randomUUID() }, payload: { enrollmentId: seed2.enrollmentId, planId: seed2.planId, monthlyPriceCents: 1000, installments: 1, startReference: '2026-07' } });
    const id2 = (c2.json() as { contract: { id: string } }).contract.id;

    expect((await app.inject({ method: 'GET', url: `/v1/contracts/${id2}`, headers: H(operatorB) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/contracts/${id2}/activate`, headers: H(operatorB) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/contracts/${id2}/cancel`, headers: H(operatorB) })).statusCode).toBe(404);
    // lista de B não contém contrato de A
    const listB = await app.inject({ method: 'GET', url: '/v1/contracts', headers: H(operatorB) });
    expect((listB.json() as { contracts: unknown[] }).contracts).toHaveLength(0);
  });

  it('ghost → 404 sem stacktrace; GET lista contém contrato do tenant', async () => {
    const ghost = await app.inject({ method: 'GET', url: '/v1/contracts/00000000-0000-4000-8000-000000000066', headers: H(operatorA) });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.body).not.toMatch(/at\s|node_modules/);
    const list = await app.inject({ method: 'GET', url: '/v1/contracts', headers: H(operatorA) });
    expect((list.json() as { contracts: { id: string }[] }).contracts.some((c) => c.id === contractId)).toBe(true);
  });

  it('auditoria registrou create/activate/cancel', async () => {
    const audit = await db.pool.query("SELECT action FROM audit_records WHERE tenant_id='A' AND resource_type='school_contract' ORDER BY seq");
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toContain('create');
    expect(actions).toContain('activate');
    expect(actions).toContain('cancel');
  });
});
