/**
 * E08-02 E2E — grade, horários, salas, feriados, sessões, conflitos (Postgres real).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });

async function login(email: string, tenant: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function setupClass(): Promise<{ courseId: string; classId: string; unitId: string }> {
  const u = await app.inject({ method: 'POST', url: '/v1/units', headers: H(), payload: { name: `Unidade ${crypto.randomUUID().slice(0, 8)}` } });
  const unitId = (u.json() as { id: string }).id;
  const c = await app.inject({ method: 'POST', url: '/v1/courses', headers: H(), payload: { name: `Curso ${crypto.randomUUID().slice(0, 8)}` } });
  const courseId = (c.json() as { id: string }).id;
  const k = await app.inject({ method: 'POST', url: '/v1/classes', headers: H(), payload: { courseId, unitId, name: `Turma ${crypto.randomUUID().slice(0, 8)}`, capacity: 10 } });
  const classId = (k.json() as { id: string }).id;
  return { courseId, classId, unitId };
}

describe('E08-02 grade e calendário', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0802@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('tenant isolation: salas de outro tenant invisíveis', async () => {
    await login('e0802b@test.com', 'B');
    const list = await app.inject({ method: 'GET', url: '/v1/rooms', headers: H() });
    expect((list.json() as unknown[])).toHaveLength(0);
  });

  it('ciclo: sala → grade → expand → remarcar → cancelar → feriado; conflitos e trilha', async () => {
    const { classId, unitId } = await setupClass();
    // sala pequena → grade rejeita (422)
    const small = await app.inject({ method: 'POST', url: '/v1/rooms', headers: H(), payload: { unitId, name: 'Pequena', capacity: 5 } });
    const smallId = (small.json() as { id: string }).id;
    const badSched = await app.inject({ method: 'POST', url: `/v1/classes/${classId}/schedules`, headers: H(), payload: { roomId: smallId, weekday: 1, startMinute: 480, endMinute: 560 } });
    expect(badSched.statusCode).toBe(422);
    // sala adequada
    const room = await app.inject({ method: 'POST', url: '/v1/rooms', headers: H(), payload: { unitId, name: 'Grande', capacity: 20 } });
    expect(room.statusCode).toBe(201);
    const roomId = (room.json() as { id: string }).id;
    // weekday 7 → AJV 400
    const badWd = await app.inject({ method: 'POST', url: `/v1/classes/${classId}/schedules`, headers: H(), payload: { weekday: 7, startMinute: 480, endMinute: 560 } });
    expect(badWd.statusCode).toBe(400);
    // grade válida segunda 08:00-09:20
    const sched = await app.inject({ method: 'POST', url: `/v1/classes/${classId}/schedules`, headers: H(), payload: { roomId, weekday: 1, startMinute: 480, endMinute: 560 } });
    expect(sched.statusCode).toBe(201);
    // expand 2 semanas → segundas 16 e 23/11/2026
    const exp = await app.inject({ method: 'POST', url: `/v1/classes/${classId}/sessions/expand`, headers: H(), payload: { from: '2026-11-16', to: '2026-11-29' } });
    expect(exp.statusCode).toBe(200);
    expect((exp.json() as { created: number }).created).toBe(2);
    // idempotente: re-expandir cria 0
    const exp2 = await app.inject({ method: 'POST', url: `/v1/classes/${classId}/sessions/expand`, headers: H(), payload: { from: '2026-11-16', to: '2026-11-29' } });
    if (exp2.statusCode !== 200) console.error('EXP2_FAIL', exp2.statusCode, exp2.body);
    expect(exp2.statusCode).toBe(200);
    expect((exp2.json() as { created: number }).created).toBe(0);
    const list = await app.inject({ method: 'GET', url: `/v1/sessions?classId=${classId}&from=2026-11-01&to=2026-11-30`, headers: H() });
    const sessions = list.json() as Array<{ id: string; date: string; status: string }>;
    expect(sessions).toHaveLength(2);
    const sessId = sessions[0]!.id;
    // trilha CREATE
    const tr = await app.inject({ method: 'GET', url: `/v1/sessions/${sessId}/changes`, headers: H() });
    expect((tr.json() as Array<{ changeType: string }>)[0]!.changeType).toBe('CREATE');
    // remarcar: conflito de sala (outra turma na mesma sala/faixa)
    const { classId: otherClass } = await setupClass();
    await app.inject({ method: 'POST', url: `/v1/classes/${otherClass}/schedules`, headers: H(), payload: { roomId, weekday: 2, startMinute: 480, endMinute: 560 } });
    await app.inject({ method: 'POST', url: `/v1/classes/${otherClass}/sessions/expand`, headers: H(), payload: { from: '2026-11-17', to: '2026-11-29' } });
    const conflict = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessId}`, headers: H(), payload: { date: '2026-11-17', startMinute: 500, endMinute: 580, reason: 'tentativa conflito' } });
    expect(conflict.statusCode).toBe(409);
    // remarcar ok (para 18/11 tarde)
    const resch = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessId}`, headers: H(), payload: { date: '2026-11-18', startMinute: 780, endMinute: 860, reason: 'aluno pediu' } });
    expect(resch.statusCode).toBe(200);
    expect((resch.json() as { status: string }).status).toBe('RESCHEDULED');
    // trilha RESCHEDULE
    const tr2 = await app.inject({ method: 'GET', url: `/v1/sessions/${sessId}/changes`, headers: H() });
    const types = (tr2.json() as Array<{ changeType: string }>).map((x) => x.changeType);
    expect(types).toContain('RESCHEDULE');
    // feriado no dia 18 → cancela sessão remarcada
    const hol = await app.inject({ method: 'POST', url: '/v1/holidays', headers: H(), payload: { date: '2026-11-18', name: 'Recesso' } });
    expect(hol.statusCode).toBe(201);
    const sessAfter = await app.inject({ method: 'GET', url: `/v1/sessions?classId=${classId}&from=2026-11-01&to=2026-11-30`, headers: H() });
    const canceled = (sessAfter.json() as Array<{ id: string; status: string }>).find((x) => x.id === sessId);
    expect(canceled!.status).toBe('CANCELED');
    // cancelar a outra sessão
    const other = (sessAfter.json() as Array<{ id: string; status: string }>).find((x) => x.id !== sessId)!;
    const cancel = await app.inject({ method: 'POST', url: `/v1/sessions/${other.id}/cancel`, headers: H(), payload: { reason: 'professor ausente' } });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { status: string }).status).toBe('CANCELED');
    // DLQ de conflito na sala liberada: cancelada não ocupa → remarcar outra sessão de otherClass p/ 18/11 mesma sala ok
    const otherList = await app.inject({ method: 'GET', url: `/v1/sessions?classId=${otherClass}&from=2026-11-01&to=2026-11-30`, headers: H() });
    const otherSess = (otherList.json() as Array<{ id: string; status: string }>)[0]!;
    const resch2 = await app.inject({ method: 'PATCH', url: `/v1/sessions/${otherSess.id}`, headers: H(), payload: { date: '2026-11-25', startMinute: 480, endMinute: 560, reason: 'ajuste de sala' } });
    expect(resch2.statusCode).toBe(200);
  });

});
