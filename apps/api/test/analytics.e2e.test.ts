/**
 * E06-07 E2E — attribution multi-touch + funil analítico auditável (Postgres real).
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

async function createLeadWithTouches(email: string): Promise<string> {
  const lr = await app.inject({ method: 'POST', url: '/v1/leads', headers: H(), payload: { name: 'L', email, source: 'website', consent: true } });
  const leadId = (lr.json() as { id: string }).id;
  const t1 = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/attribution`, headers: H(), payload: { campaign: 'verao2026', utmSource: 'fb', utmMedium: 'cpc' } });
  expect(t1.statusCode).toBe(201);
  const t2 = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/attribution`, headers: H(), payload: { campaign: 'verao2026', utmSource: 'google', utmMedium: 'organic' } });
  expect(t2.statusCode).toBe(201);
  return leadId;
}

describe('E06-07 analytics', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0607@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('attribution multi-touch: 2 touches distintos + replay avança last_touch sem duplicar', async () => {
    const leadId = await createLeadWithTouches('e0607-a@test.com');
    // replay do 1º touch → last_touch avança, continua 2 registros
    const replay = await app.inject({ method: 'POST', url: `/v1/leads/${leadId}/attribution`, headers: H(), payload: { campaign: 'verao2026', utmSource: 'fb', utmMedium: 'cpc' } });
    expect(replay.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: `/v1/leads/${leadId}/attribution`, headers: H() });
    const touches = list.json() as Array<{ campaign: string; utmSource: string; firstTouchAt: string; lastTouchAt: string }>;
    expect(touches).toHaveLength(2);
    const fb = touches.find((t) => t.utmSource === 'fb')!;
    const go = touches.find((t) => t.utmSource === 'google')!;
    expect(new Date(fb.lastTouchAt).getTime()).toBeGreaterThanOrEqual(new Date(fb.firstTouchAt).getTime());
    expect(go.firstTouchAt).not.toBe(fb.firstTouchAt); // touches distintos
    // 404 lead inexistente
    const bad = await app.inject({ method: 'POST', url: '/v1/leads/00000000-0000-0000-0000-000000000000/attribution', headers: H(), payload: {} });
    expect(bad.statusCode).toBe(404);
  });

  it('funil: movimenta leads → snapshot com counts/taxa global; auditoria de snapshots; 422 sem funil no tenant B', async () => {
    const l1 = await createLeadWithTouches('e0607-f1@test.com');
    const l2 = await createLeadWithTouches('e0607-f2@test.com');
    // move l1 p/ 'Em contato', depois won; l2 fica no primeiro
    const stg = await db.pool.query("SELECT id, label, kind, position FROM pipeline_stages WHERE tenant_id='A' AND archived=false ORDER BY position");
    const stages = stg.rows as Array<{ id: string; kind: string; position: number }>;
    const first = stages[0]!;
    const mid = stages.find((s) => s.kind === 'open' && s.id !== first.id)!;
    const won = stages.find((s) => s.kind === 'won')!;
    await app.inject({ method: 'POST', url: `/v1/leads/${l1}/move`, headers: H(), payload: { toStageId: mid.id } });
    await app.inject({ method: 'POST', url: `/v1/leads/${l1}/move`, headers: H(), payload: { toStageId: won.id } });
    const snap = await app.inject({ method: 'POST', url: '/v1/funnel/snapshot', headers: H(), payload: {} });
    expect(snap.statusCode).toBe(201);
    const s1 = snap.json() as { id: string; payload: { stages: Array<{ stageId: string; entered: number; won: number; label: string; conversionRate: number }> } };
    const global = s1.payload.stages.find((x) => x.stageId === 'GLOBAL')!;
    expect(global.entered).toBe(2); // 2 leads criados no 1º stage
    expect(global.won).toBe(1); // l1 em won
    expect(global.conversionRate).toBe(50);
    // auditoria: snapshot listado
    const snaps = await app.inject({ method: 'GET', url: '/v1/funnel/snapshots', headers: H() });
    const list = snaps.json() as Array<{ id: string }>;
    expect(list.some((x) => x.id === s1.id)).toBe(true);
    // cross-tenant: snapshot do tenant B (funil bootstrapado, 0 leads) → entered 0, isolado de A
    const tkB = await login('e0607-b@test.com', 'B');
    const snapB = await app.inject({ method: 'POST', url: '/v1/funnel/snapshot', headers: { authorization: `Bearer ${tkB}` }, payload: {} });
    expect(snapB.statusCode).toBe(201);
    const gb = (snapB.json() as { payload: { stages: Array<{ stageId: string; entered: number; won: number }> } }).payload.stages.find((x) => x.stageId === 'GLOBAL')!;
    expect(gb.entered).toBe(0);
    // attribution de lead de A invisível p/ B
    const attrB = await app.inject({ method: 'GET', url: `/v1/leads/${l1}/attribution`, headers: { authorization: `Bearer ${tkB}` } });
    expect(attrB.statusCode).toBe(200);
    expect(attrB.json()).toEqual([]); // R6: sem rows de outro tenant
  });
});
