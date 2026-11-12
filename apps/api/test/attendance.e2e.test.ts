/**
 * E08-03 E2E — chamada em lote, revisão com trilha, relatório de frequência, isolamento (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });
let tenantA = '';
let sessionId = '';
let sessionId2 = '';
let classId = '';
let enrollmentA1 = '';
let enrollmentA2 = '';

async function login(email: string, tenant: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function seedTenant(tenant: string, suffix: string): Promise<{ classId: string; sessionId: string; sessionId2: string; enr1: string; enr2: string }> {
  const unit = (await db.pool.query(
    'INSERT INTO units (tenant_id, name) VALUES ($1,$2) RETURNING id', [tenant, `Unidade ${suffix}`])).rows[0]!.id as string;
  const course = (await db.pool.query(
    'INSERT INTO courses (tenant_id, name) VALUES ($1,$2) RETURNING id', [tenant, `Curso ${suffix}`])).rows[0]!.id as string;
  const cls = (await db.pool.query(
    'INSERT INTO classes (tenant_id, course_id, unit_id, name, capacity) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [tenant, course, unit, `Turma ${suffix}`, 30])).rows[0]!.id as string;
  const mkSession = async (date: string) => (await db.pool.query(
    'INSERT INTO class_sessions (tenant_id, class_id, date, start_minute, end_minute) VALUES ($1,$2,$3,600,720) RETURNING id',
    [tenant, cls, date])).rows[0]!.id as string;
  const s1 = await mkSession('2026-11-10');
  const s2 = await mkSession('2026-11-11');
  const mkStudent = async (n: string) => (await db.pool.query(
    'INSERT INTO people (tenant_id, unit_id, kind, name) VALUES ($1,$2,$3,$4) RETURNING id',
    [tenant, unit, 'STUDENT', n])).rows[0]!.id as string;
  const p1 = await mkStudent(`Aluno 1 ${suffix}`);
  const p2 = await mkStudent(`Aluno 2 ${suffix}`);
  const mkEnr = async (student: string) => (await db.pool.query(
    'INSERT INTO enrollments (id, tenant_id, student_id, offer_id, state) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [crypto.randomUUID(), tenant, student, 'oferta-x', 'ACTIVE'])).rows[0]!.id as string;
  return { classId: cls, sessionId: s1, sessionId2: s2, enr1: await mkEnr(p1), enr2: await mkEnr(p2) };
}

describe('E08-03 attendance', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    const t = await db.pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
    tenantA = t.rows[0]!.id as string;
    token = await login('e0803@test.com', tenantA);
    const fx = await seedTenant(tenantA, 'A');
    classId = fx.classId; sessionId = fx.sessionId; sessionId2 = fx.sessionId2;
    enrollmentA1 = fx.enr1; enrollmentA2 = fx.enr2;
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('ISOL: attendance de outro tenant invisível (404/empty)', async () => {
    const t2 = (await db.pool.query('INSERT INTO tenants (id) VALUES ($1) RETURNING id', [crypto.randomUUID()])).rows[0]!.id as string;
    const tok2 = await login('iso0803@test.com', t2);
    const H2 = { authorization: `Bearer ${tok2}` };
    // sessão do tenantA não existe para t2 → 404
    const post = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/attendance`, headers: H2, payload: { entries: [{ enrollmentId: enrollmentA1, status: 'PRESENT' }] } });
    expect(post.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/attendance`, headers: H2 });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(0);
    const rep = await app.inject({ method: 'GET', url: `/v1/classes/${classId}/attendance-report?from=2026-11-01&to=2026-11-30`, headers: H2 });
    expect(rep.statusCode).toBe(200);
    expect(rep.json() as unknown[]).toHaveLength(0);
  });

  it('lote → justificada/atraso → revisão com trilha → relatório; 400/404/409-422', async () => {
    // AJV: status inválido → 400
    const bad = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/attendance`, headers: H(), payload: { entries: [{ enrollmentId: enrollmentA1, status: 'FERIAS' }] } });
    expect(bad.statusCode).toBe(400);
    // sessão inexistente → 404
    const nf = await app.inject({ method: 'POST', url: `/v1/sessions/${crypto.randomUUID()}/attendance`, headers: H(), payload: { entries: [{ enrollmentId: enrollmentA1, status: 'PRESENT' }] } });
    expect(nf.statusCode).toBe(404);
    // domínio: JUSTIFIED sem justificativa → 422
    const noJust = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/attendance`, headers: H(), payload: { entries: [{ enrollmentId: enrollmentA1, status: 'JUSTIFIED' }] } });
    expect(noJust.statusCode).toBe(422);
    // lote: aluno1 PRESENT, aluno2 LATE 10min
    const batch = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/attendance`, headers: H(), payload: { entries: [
      { enrollmentId: enrollmentA1, status: 'PRESENT' },
      { enrollmentId: enrollmentA2, status: 'LATE', minutesLate: 10 },
    ] } });
    if (batch.statusCode !== 201) console.error('BATCH_FAIL', batch.statusCode, batch.body);
    expect(batch.statusCode).toBe(201);
    expect(batch.json()).toHaveLength(2);
    // re-lote idempotente: upsert mesmo registro
    const batch2 = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/attendance`, headers: H(), payload: { entries: [{ enrollmentId: enrollmentA1, status: 'ABSENT' }] } });
    expect(batch2.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/attendance`, headers: H() });
    expect(list.statusCode).toBe(200);
    expect(list.json() as unknown[]).toHaveLength(2);
    // revisão ABSENT→JUSTIFIED com justificativa
    const attId = ((list.json() as Array<{ id: string; enrollmentId: string; status: string }>)).find((x) => x.enrollmentId === enrollmentA1)!.id;
    const rev = await app.inject({ method: 'PATCH', url: `/v1/attendance/${attId}`, headers: H(), payload: { status: 'JUSTIFIED', reason: 'atestado recebido', justification: 'atestado médico' } });
    if (rev.statusCode !== 200) console.error('REV_FAIL', rev.statusCode, rev.body);
    expect(rev.statusCode).toBe(200);
    expect((rev.json() as { status: string }).status).toBe('JUSTIFIED');
    // trilha old→new
    const chg = await app.inject({ method: 'GET', url: `/v1/attendance/${attId}/changes`, headers: H() });
    expect(chg.statusCode).toBe(200);
    const changes = chg.json() as Array<{ oldStatus: string; newStatus: string; reason: string }>;
    expect(changes[0]!.oldStatus).toBe('ABSENT');
    expect(changes[0]!.newStatus).toBe('JUSTIFIED');
    // revisão sem reason → 400 AJV
    const revBad = await app.inject({ method: 'PATCH', url: `/v1/attendance/${attId}`, headers: H(), payload: { status: 'PRESENT' } });
    expect(revBad.statusCode).toBe(400);
    // revisão inexistente → 404
    const revNf = await app.inject({ method: 'PATCH', url: `/v1/attendance/${crypto.randomUUID()}`, headers: H(), payload: { status: 'PRESENT', reason: 'x' } });
    expect(revNf.statusCode).toBe(404);
    // sessão 2: aluno1 PRESENT, aluno2 ABSENT → relatório
    const b2 = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId2}/attendance`, headers: H(), payload: { entries: [
      { enrollmentId: enrollmentA1, status: 'PRESENT' },
      { enrollmentId: enrollmentA2, status: 'ABSENT' },
    ] } });
    expect(b2.statusCode).toBe(201);
    const rep = await app.inject({ method: 'GET', url: `/v1/classes/${classId}/attendance-report?from=2026-11-01&to=2026-11-30`, headers: H() });
    if (rep.statusCode !== 200) console.error('REP_FAIL', rep.statusCode, rep.body);
    expect(rep.statusCode).toBe(200);
    const rows = rep.json() as Array<{ enrollmentId: string; total: number; presentCount: number; lateCount: number; percent: number }>;
    const a1 = rows.find((r) => r.enrollmentId === enrollmentA1)!;
    const a2 = rows.find((r) => r.enrollmentId === enrollmentA2)!;
    expect(a1.total).toBe(2); // PRESENT + PRESENT (rev p/ JUSTIFIED não conta como presença)
    expect(a1.percent).toBe(50);
    expect(a2.total).toBe(2); // LATE + ABSENT → 1 presente
    expect(a2.lateCount).toBe(1);
    expect(a2.percent).toBe(50);
    // período sem sessões → vazio
    const repEmpty = await app.inject({ method: 'GET', url: `/v1/classes/${classId}/attendance-report?from=2020-01-01&to=2020-12-31`, headers: H() });
    expect(repEmpty.json() as unknown[]).toHaveLength(0);
  });
});
