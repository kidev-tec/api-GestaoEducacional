/**
 * E06-B E2E — funil configurável + Kanban + histórico (Postgres real).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startTestDb, type TestDb } from '../../../packages/infra/src/test-db.js';
import { createLead } from '../../../packages/infra/src/lead-repositories.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const H = () => ({ authorization: `Bearer ${token}` });

async function login(email: string, tenant: string) {
  const argon = await import('argon2');
  await db.pool.query(
    'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [randomUUID(), tenant, email, await argon.hash('correct-horse-123', { type: argon.argon2id }), 'operator'],
  );
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'correct-horse-123' } });
  return (r.json() as { token: string }).token;
}

async function createLeadViaApi(email: string, consent = true) {
  const r = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: {
    name: 'Lead', email, source: 'website', consent,
  } });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

describe('E06-B funil', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e06b@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('board default + cria estágio + move lead com histórico + métricas', async () => {
    const board0 = await app.inject({ method: 'GET', url: '/v1/pipelines/default/board', headers: H() });
    expect(board0.statusCode).toBe(200);
    const cols0 = board0.json() as Array<{ stageId: string; kind: string; count: number }>;
    expect(cols0.filter((c) => c.kind === 'won')).toHaveLength(1);
    const opens = cols0.filter((c) => c.kind === 'open');

    // cria estágio custom
    const cs = await app.inject({ method: 'POST', url: '/v1/pipelines/default/stages', headers: H(), payload: { label: 'Visita', kind: 'open', afterPosition: 1 } });
    expect(cs.statusCode).toBe(201);
    const visita = cs.json() as { id: string };

    // lead em Novo → move para Visita (adjacente? Novo é pos 1, Visita agora é pos 2)
    const leadId = await createLeadViaApi('e06b-lead@test.com');
    const mv = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/move`, headers: H(), payload: { toStageId: visita.id } });
    expect(mv.statusCode).toBe(200);

    // pulo não adjacente: Visita → QUALIFIED (pos 4 agora) rejeita
    const stg = await db.pool.query("SELECT id FROM pipeline_stages WHERE tenant_id='A' AND label='Qualificado' AND archived=false");
    const qId = (stg.rows[0] as { id: string }).id;
    const skip = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/move`, headers: H(), payload: { toStageId: qId } });
    expect(skip.statusCode).toBe(422);

    // WON sem consent → 403; com consent → ok
    const leadNC = await createLeadViaApi('e06b-nc@test.com', false);
    const wonId = cols0.find((c) => c.kind === 'won')!.stageId;
    const noC = await app.inject({ method: 'POST', url: `/v1/leads/${leadNC}/move`, headers: H(), payload: { toStageId: wonId } });
    expect(noC.statusCode).toBe(403);
    const okC = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/move`, headers: H(), payload: { toStageId: wonId } });
    expect(okC.statusCode).toBe(200);

    // board reflete contagem no won
    const board1 = await app.inject({ method: 'GET', url: '/v1/pipelines/default/board', headers: H() });
    const won = (board1.json() as Array<{ stageId: string; count: number }>).find((c) => c.stageId === wonId)!;
    expect(won.count).toBeGreaterThanOrEqual(1);

    // metrics
    const met = await app.inject({ method: 'GET', url: '/v1/pipelines/default/metrics', headers: H() });
    expect(met.statusCode).toBe(200);
    const m = met.json() as { wonRate: number; stageConversion: unknown[] };
    expect(m.wonRate).toBeGreaterThan(0);
    expect(m.stageConversion.length).toBeGreaterThanOrEqual(3);

    // rename; archive com lead bloqueia
    const rn = await app.inject({ method: 'PATCH', url: `/v1/pipelines/default/stages/${visita.id}`, headers: H(), payload: { label: 'Visita agendada' } });
    expect(rn.statusCode).toBe(200);
    const arFull = await app.inject({ method: 'PATCH', url: `/v1/pipelines/default/stages/${visita.id}`, headers: H(), payload: { archive: true } });
    expect(arFull.statusCode).toBe(409);

    // estágio vazio arquiva
    const cs2 = await app.inject({ method: 'POST', url: '/v1/pipelines/default/stages', headers: H(), payload: { label: 'Proposta', kind: 'open' } });
    expect(cs2.statusCode).toBe(201);
    const prop = cs2.json() as { id: string };
    const ar = await app.inject({ method: 'PATCH', url: `/v1/pipelines/default/stages/${prop.id}`, headers: H(), payload: { archive: true } });
    expect(ar.statusCode).toBe(200);

    // won duplicado → 422
    const dupWon = await app.inject({ method: 'POST', url: '/v1/pipelines/default/stages', headers: H(), payload: { label: 'Ganho2', kind: 'won' } });
    expect(dupWon.statusCode).toBe(422);

    // reorder inválido e válido
    const badRe = await app.inject({ method: 'POST', url: '/v1/pipelines/default/stages/reorder', headers: H(), payload: { orderedIds: ['00000000-0000-4000-8000-000000000000'] } });
    expect(badRe.statusCode).toBe(422);
    const b2 = await app.inject({ method: 'GET', url: '/v1/pipelines/default/board', headers: H() });
    const opens2 = (b2.json() as Array<{ stageId: string; kind: string }>).filter((c) => c.kind === 'open').map((c) => c.stageId);
    const okRe = await app.inject({ method: 'POST', url: '/v1/pipelines/default/stages/reorder', headers: H(), payload: { orderedIds: opens2.reverse() } });
    if (okRe.statusCode !== 200) console.error('RE_FAIL', okRe.statusCode, okRe.body);
    expect(okRe.statusCode).toBe(200);
  });

  it('cross-tenant: estágio de outro tenant → 404', async () => {
    const stg = await db.pool.query("SELECT id FROM pipeline_stages WHERE tenant_id='A' LIMIT 1");
    const idA = (stg.rows[0] as { id: string }).id;
    await db.pool.query("INSERT INTO tenants (id) VALUES ('B') ON CONFLICT DO NOTHING");
    const tkB = await login('e06b-b@test.com', 'B');
    const r = await app.inject({ method: 'PATCH', url: `/v1/pipelines/default/stages/${idA}`, headers: { authorization: `Bearer ${tkB}` }, payload: { label: 'hack' } });
    expect(r.statusCode).toBe(404);
    const mv = await app.inject({ method: 'GET', url: '/v1/pipelines/default/board', headers: { authorization: `Bearer ${tkB}` } });
    expect(mv.statusCode).toBe(200);
    // tenant B tem pipeline próprio (bootstrap), não vê estágios de A
    const boardB = mv.json() as Array<{ stageId: string }>;
    expect(boardB.every((c) => c.stageId !== idA)).toBe(true);
  });
});
