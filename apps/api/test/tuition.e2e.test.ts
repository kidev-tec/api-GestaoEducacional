/**
 * E07-A — E2E HTTP: mensalidades contra Postgres real.
 * Cobre: planos, geração idempotente, settle, cancel, cross-tenant, validação.
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

const H = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

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
  operatorA = await seed('t07-ops-a@test', 'A', 'operator');
  viewerA = await seed('t07-view-a@test', 'A', 'viewer');
  operatorB = await seed('t07-ops-b@test', 'B', 'operator');
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

let planA = '';
let studentA = '';
let tuitionId = '';

async function seedStudentAndPlan() {
  const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Unid E07' } });
  const unitId = (unit.json() as { id: string }).id;
  const person = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: 'Aluno Mensal', unitId } });
  expect(person.statusCode, person.body).toBe(201);
  studentA = (person.json() as { id: string }).id;
  const plan = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: H(operatorA), payload: { name: 'Mensal 2026', amountCents: 50000, dueDay: 5 } });
  expect(plan.statusCode, plan.body).toBe(201);
  planA = (plan.json() as { id: string }).id;
}

describe('E07-A tuition', () => {
  it('viewer não cria plano (403); operator cria e lista', async () => {
    const forbidden = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: H(viewerA), payload: { name: 'X', amountCents: 100, dueDay: 1 } });
    expect(forbidden.statusCode).toBe(403);

    await seedStudentAndPlan();
    const list = await app.inject({ method: 'GET', url: '/v1/tuition/plans', headers: H(viewerA) });
    expect(list.statusCode).toBe(200);
    const plans = (list.json() as { plans: { id: string }[] }).plans;
    expect(plans.some((p) => p.id === planA)).toBe(true);
  });

  it('validação: amountCents 0 / dueDay 13 / reference inválida → 400', async () => {
    const zero = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: H(operatorA), payload: { name: 'X', amountCents: 0, dueDay: 5 } });
    expect(zero.statusCode).toBe(400);
    const day = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: H(operatorA), payload: { name: 'X', amountCents: 100, dueDay: 13 } });
    expect(day.statusCode).toBe(400);
    const badRef = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: studentA, reference: '2026-13' } });
    expect(badRef.statusCode).toBe(400);
  });

  it('gera tuition OPEN com CHARGE; dueDate default do plano; duplicada → 409', async () => {
    const gen = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: studentA, reference: '2026-03' } });
    expect(gen.statusCode, gen.body).toBe(201);
    const t = gen.json() as { id: string; dueDate: string; status: string; ledgerEntryId: string; amountCents: number };
    expect(t.status).toBe('OPEN');
    expect(t.dueDate).toBe('2026-03-05');
    expect(t.amountCents).toBe(50000);
    expect(t.ledgerEntryId).toBeTruthy();
    tuitionId = t.id;

    const dup = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: studentA, reference: '2026-03' } });
    expect(dup.statusCode, dup.body).toBe(409);
  });

  it('saldo do ledger reflete o CHARGE (+50000)', async () => {
    const balance = await db.pool.query("SELECT COALESCE(SUM(amount_cents),0) AS b FROM ledger_entries WHERE tenant_id = 'A' AND type = 'CHARGE'");
    expect(Number(balance.rows[0].b)).toBe(50000);
  });

  it('settle com valor errado → 422; correto → SETTLED + PAYMENT; settle duplo → 422; replay idempotente', async () => {
    const wrong = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/settle`, headers: H(operatorA), payload: { paymentAmountCents: 40000, idempotencyKey: 'settle-1' } });
    expect(wrong.statusCode).toBe(422);

    const ok = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/settle`, headers: H(operatorA), payload: { paymentAmountCents: 50000, idempotencyKey: 'settle-1' } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as { tuition: { status: string } }).tuition.status).toBe('SETTLED');

    // replay com mesma key + mesmo payload → 200 (idempotente), tuition permanece SETTLED
    const replay = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/settle`, headers: H(operatorA), payload: { paymentAmountCents: 50000, idempotencyKey: 'settle-1' } });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { tuition: { status: string } }).tuition.status).toBe('SETTLED');

    const again = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/settle`, headers: H(operatorA), payload: { paymentAmountCents: 50000, idempotencyKey: 'settle-2' } });
    expect(again.statusCode).toBe(422);

    // cancel de SETTLED → 422
    const cancelSettled = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/cancel`, headers: H(operatorA) });
    expect(cancelSettled.statusCode).toBe(422);
  });

  it('cancel de OPEN → CANCELED + REVERSAL espelhada; cancel duplo → 422', async () => {
    const gen = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: studentA, reference: '2026-04' } });
    const t2 = (gen.json() as { id: string }).id;

    const cancel = await app.inject({ method: 'POST', url: `/v1/tuition/${t2}/cancel`, headers: H(operatorA) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((cancel.json() as { status: string }).status).toBe('CANCELED');

    const bal = await db.pool.query("SELECT amount_cents FROM ledger_entries WHERE tenant_id = 'A' AND type = 'REVERSAL'");
    expect(bal.rows.map((r) => Number(r.amount_cents))).toContain(-50000);

    const twice = await app.inject({ method: 'POST', url: `/v1/tuition/${t2}/cancel`, headers: H(operatorA) });
    expect(twice.statusCode).toBe(422);
  });

  it('isolamento cross-tenant: B não lê/gera/cancela tuition de A', async () => {
    const got = await app.inject({ method: 'GET', url: `/v1/tuition/${tuitionId}`, headers: H(operatorB) });
    expect(got.statusCode).toBe(404);

    const listB = await app.inject({ method: 'GET', url: '/v1/tuition', headers: H(operatorB) });
    expect((listB.json() as { tuitions: unknown[] }).tuitions).toHaveLength(0);

    // plano de A não existe para B
    const genB = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorB), payload: { planId: planA, studentId: studentA, reference: '2026-05' } });
    expect(genB.statusCode).toBe(404);

    const cancelB = await app.inject({ method: 'POST', url: `/v1/tuition/${tuitionId}/cancel`, headers: H(operatorB) });
    expect(cancelB.statusCode).toBe(404);

    // settle de tuition de A por B → 404
    const genC = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: studentA, reference: '2026-06' } });
    const tC = (genC.json() as { id: string }).id;
    const settleB = await app.inject({ method: 'POST', url: `/v1/tuition/${tC}/settle`, headers: H(operatorB), payload: { paymentAmountCents: 50000, idempotencyKey: 'b-key' } });
    expect(settleB.statusCode).toBe(404);
    // e não mutou
    const still = await app.inject({ method: 'GET', url: `/v1/tuition/${tC}`, headers: H(operatorA) });
    expect((still.json() as { status: string }).status).toBe('OPEN');
  });

  it('student kind errado → 422; querystring status inválida → 400; filtros funcionam', async () => {
    const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Unid E07b' } });
    const unitId = (unit.json() as { id: string }).id;
    const staff = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STAFF', name: 'Func', unitId } });
    expect(staff.statusCode, staff.body).toBe(201);
    const staffId = (staff.json() as { id: string }).id;
    const genStaff = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: H(operatorA), payload: { planId: planA, studentId: staffId, reference: '2026-07' } });
    expect(genStaff.statusCode).toBe(422);

    const badQ = await app.inject({ method: 'GET', url: '/v1/tuition?status=LATER', headers: H(operatorA) });
    expect(badQ.statusCode).toBe(400);

    const filter = await app.inject({ method: 'GET', url: '/v1/tuition?status=SETTLED', headers: H(operatorA) });
    const rows = (filter.json() as { tuitions: { status: string }[] }).tuitions;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'SETTLED')).toBe(true);
  });

  it('GET /v1/tuition/:id ghost → 404 sem stacktrace', async () => {
    const got = await app.inject({ method: 'GET', url: '/v1/tuition/00000000-0000-4000-8000-000000000077', headers: H(operatorA) });
    expect(got.statusCode).toBe(404);
    expect(got.body).not.toMatch(/at\s|node_modules/);
  });
});
