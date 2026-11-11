/**
 * E03-C — consumer real do outbox E2E (Postgres real).
 * RF-02: generate tuition → tick worker → processed + notified_at.
 * RF-03: GET /v1/outbox/stats.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { OutboxWorker } from '../src/outbox-worker.js';
import { startTestDb } from '../../../packages/infra/src/test-db.js';
import { generateTuition } from '../../../packages/infra/src/tuition-repositories.js';
import { withTransaction } from '../../../packages/infra/src/repositories.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';

const H = () => ({ authorization: `Bearer ${token}` });

async function login() {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), 'A', 'e03c@test', await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'e03c@test', password: 'correct-horse-123' } });
  token = (r.json() as { token: string }).token;
}

async function seedPlanStudent() {
  const plan = await db.pool.query("INSERT INTO tuition_plans (id, tenant_id, name, amount_cents, due_day) VALUES ($1,'A','Plano',10000,5) RETURNING id", [randomUUID()]).then((r) => (r.rows[0] as { id: string }).id);
  const unit = await db.pool.query("INSERT INTO units (id, tenant_id, name) VALUES ($1,'A','U') RETURNING id", [randomUUID()]).then((r) => (r.rows[0] as { id: string }).id);
  const student = await db.pool.query("INSERT INTO people (id, tenant_id, unit_id, kind, name) VALUES ($1,'A',$2,'STUDENT','Aluno') RETURNING id", [randomUUID(), unit]).then((r) => (r.rows[0] as { id: string }).id);
  return { plan, unit, student };
}

describe('E03-C consumer do outbox', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    await login();
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('RF-02: generate → worker tick → processed + notified_at preenchido; idempotente no re-tick', async () => {
    const { plan, student } = await seedPlanStudent();
    const t = await withTransaction(db.pool, (c) => generateTuition(c, {
      tenantId: 'A', planId: plan, studentId: student,
      reference: '2026-11', dueDate: '2026-11-05',
    }));

    const worker = new OutboxWorker({ pool: db.pool });
    // mesmo handler do server.ts (RF-02) — idempotente por notified_at IS NULL
    worker.on('tuition.generated', async (ev) => {
      const p = ev.payload as { tuitionId?: string };
      if (!p?.tuitionId) throw new Error('sem tuitionId');
      await db.pool.query(
        'UPDATE tuitions SET notified_at = now() WHERE id = $1 AND tenant_id = $2 AND notified_at IS NULL',
        [p.tuitionId, ev.tenantId],
      );
    });
    const tick1 = await worker.tick();

    const ev = await db.pool.query("SELECT processed_at FROM outbox_events WHERE tenant_id='A' AND type='tuition.generated' ORDER BY created_at DESC LIMIT 1");
    expect((ev.rows[0] as { processed_at: string | null }).processed_at).not.toBeNull();

    const tut = await db.pool.query('SELECT notified_at FROM tuitions WHERE id=$1', [t.id]);
    expect((tut.rows[0] as { notified_at: string | null }).notified_at).not.toBeNull();

    // re-tick: idempotente — nada novo processado
    const tick2 = await worker.tick();
    expect(tick2.processed).toBe(0);
    expect(tick1.processed).toBeGreaterThanOrEqual(1);
  });

  it('RF-03: GET /v1/outbox/stats com contagens por status; 401 sem sessão', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/outbox/stats', headers: H() });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { pending: number; processed: number; dlq: number };
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.dlq).toBe(0);

    const noAuth = await app.inject({ method: 'GET', url: '/v1/outbox/stats' });
    expect(noAuth.statusCode).toBe(401);
  });
});
