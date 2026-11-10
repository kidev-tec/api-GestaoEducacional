/**
 * E03-A E2E — outbox persistente contra Postgres real (testcontainer):
 * tuition gerada → evento pending na mesma tx → worker processa → processed.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, resetLoginLimiter } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';
import { OutboxWorker } from '../src/outbox-worker.js';
import type { Pool } from 'pg';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};

async function login(tenant: string): Promise<string> {
  if (tokens[tenant]) return tokens[tenant];
  const email = `outbox-${tenant}@test`;
  const argon = await import('argon2');
  const hash = await argon.hash('correct-horse-123', { type: argon.argon2id });
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), tenant, email, hash, 'operator'],
  );
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  tokens[tenant] = (res.json() as { token: string }).token;
  return tokens[tenant];
}

beforeAll(async () => {
  db = await startTestDb();
  app = await buildApp({ pool: db.pool });
  await app.ready();
}, 120_000);

afterAll(async () => {
  resetLoginLimiter();
  await app.close();
  await db.teardown();
});

async function seedUnitAndStudentAndPlan(token: string): Promise<{ studentId: string; planId: string }> {
  const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `Bearer ${token}` }, payload: { name: `Unid OBX ${randomUUID().slice(0, 6)}` } });
  const person = await app.inject({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'STUDENT', name: `Aluno OBX ${randomUUID().slice(0, 6)}`, unitId: unit.json().id } });
  const plan = await app.inject({ method: 'POST', url: '/v1/tuition/plans', headers: { authorization: `Bearer ${token}` }, payload: { name: `Plano OBX ${randomUUID().slice(0, 6)}`, amountCents: 50000, dueDay: 5 } });
  return { studentId: person.json().id, planId: plan.json().id };
}

describe('outbox persistente + worker (E03-A)', () => {
  it('generate → evento pending visível em GET /v1/outbox → worker tick → processed', async () => {
    const token = await login('A');
    const { studentId, planId } = await seedUnitAndStudentAndPlan(token);
    const gen = await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: { authorization: `Bearer ${token}` }, payload: { planId, studentId, reference: '2026-07' } });
    expect(gen.statusCode).toBe(201);

    const pending = await app.inject({ method: 'GET', url: '/v1/outbox?status=pending', headers: { authorization: `Bearer ${token}` } });
    expect(pending.statusCode).toBe(200);
    const events = pending.json().events as { id: string; type: string; processedAt: string | null; payload: { tuitionId?: string } }[];
    const evA = events.find((e) => e.type === 'tuition.generated' && e.payload.tuitionId === gen.json().id);
    expect(evA).toBeTruthy();
    expect(evA?.processedAt).toBeNull();

    // worker real contra o pool do container
    const handled: string[] = [];
    const w = new OutboxWorker({ pool: db.pool as Pool, batchSize: 10, backoffMs: 60_000 });
    w.on('tuition.generated', (e) => { handled.push(e.id); });
    const res = await w.tick();
    expect(res.processed).toBeGreaterThanOrEqual(1);

    const after = await app.inject({ method: 'GET', url: '/v1/outbox?status=processed', headers: { authorization: `Bearer ${token}` } });
    const processed = (after.json().events as { id: string }[]).map((e) => e.id);
    expect(processed).toContain(evA!.id);
    expect(handled).toContain(evA!.id);

    // reentrega: novo tick não reprocessa (processed)
    const res2 = await w.tick();
    expect(res2.processed).toBe(0);
  });

  it('restart não perde evento: novo worker pega pending gravado', async () => {
    const token = await login('B');
    const { studentId, planId } = await seedUnitAndStudentAndPlan(token);
    await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: { authorization: `Bearer ${token}` }, payload: { planId, studentId, reference: '2026-08' } });

    // worker NOVO (simula restart) sem tick prévio
    const w2 = new OutboxWorker({ pool: db.pool as Pool, batchSize: 10, backoffMs: 60_000 });
    const seen: string[] = [];
    w2.on('tuition.generated', (e) => { seen.push((e.payload as { tuitionId?: string }).tuitionId ?? ''); });
    const res = await w2.tick();
    expect(res.processed).toBeGreaterThanOrEqual(1);

    const list = await app.inject({ method: 'GET', url: '/v1/outbox', headers: { authorization: `Bearer ${token}` } });
    const all = list.json().events as { processedAt: string | null; payload: { tuitionId?: string } }[];
    const mine = all.filter((e) => e.payload.tuitionId !== undefined);
    expect(mine.length).toBeGreaterThan(0);
  });

  it('handler falhando: attempts sobe; após 5 tentativas vai p/ DLQ', async () => {
    const token = await login('A');
    const { studentId, planId } = await seedUnitAndStudentAndPlan(token);
    await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: { authorization: `Bearer ${token}` }, payload: { planId, studentId, reference: '2026-09' } });

    const failing = await db.pool.query(
      `SELECT id FROM outbox_events WHERE type='tuition.generated' AND processed_at IS NULL AND attempts = 0 ORDER BY created_at DESC LIMIT 1`,
    );
    const targetId = (failing.rows[0] as { id: string }).id;

    const w = new OutboxWorker({ pool: db.pool as Pool, batchSize: 50, backoffMs: 0, retryBaseMs: 0 });
    w.on('tuition.generated', (e) => { if (e.id === targetId) throw new Error('boom'); else { /* ok */ } });
    for (let i = 0; i < 5; i++) await w.tick();

    const dlq = await app.inject({ method: 'GET', url: '/v1/outbox?status=dlq', headers: { authorization: `Bearer ${token}` } });
    const dlqIds = (dlq.json().events as { id: string; attempts: number }[]).map((e) => e.id);
    expect(dlqIds).toContain(targetId);

    // tick 6: DLQ não é mais reclamada (attempts >= MAX fora do claim)
    const res6 = await w.tick();
    expect(res6.claimed).toBe(0);
    // e a listagem dlq confirma
    const dlq2 = await app.inject({ method: 'GET', url: '/v1/outbox?status=dlq', headers: { authorization: `Bearer ${token}` } });
    expect((dlq2.json().events as { id: string }[]).some((e) => e.id === targetId)).toBe(true);
  });

  it('cross-tenant: sessão B não vê eventos de A', async () => {
    const tokenA = await login('A');
    const tokenB = await login('B');
    const { studentId, planId } = await seedUnitAndStudentAndPlan(tokenA);
    await app.inject({ method: 'POST', url: '/v1/tuition/generate', headers: { authorization: `Bearer ${tokenA}` }, payload: { planId, studentId, reference: '2026-10' } });

    const listB = await app.inject({ method: 'GET', url: '/v1/outbox', headers: { authorization: `Bearer ${tokenB}` } });
    const tenants = new Set((listB.json().events as { tenantId: string }[]).map((e) => e.tenantId));
    expect([...tenants]).toEqual(['B']);
  });

  it('status inválido → 400', async () => {
    const token = await login('A');
    const res = await app.inject({ method: 'GET', url: '/v1/outbox?status=bogus', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
  });

  it('sem auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/outbox' });
    expect(res.statusCode).toBe(401);
  });
});
