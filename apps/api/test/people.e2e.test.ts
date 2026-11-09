/**
 * E05-A — E2E HTTP: unidades, pessoas e responsáveis contra Postgres real.
 * Cobre: ciclo de unidade, cross-tenant, guardianship rules, isolamento por sessão.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
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
  operatorA = await seed('p05-ops-a@test', 'A', 'operator');
  viewerA = await seed('p05-view-a@test', 'A', 'viewer');
  operatorB = await seed('p05-ops-b@test', 'B', 'operator');
}, 120_000);
afterAll(async () => { await app.close(); await db.teardown(); }, 120_000);

describe('E05-A units', () => {
  it('cria hierarquia e lista; pai inexistente/cross-tenant → 404; isolamento', async () => {
    const root = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Sede Jaú' } });
    expect(root.statusCode).toBe(201);
    const rootId = (root.json() as { id: string }).id;
    const child = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Anexo', parentId: rootId } });
    expect(child.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/v1/units', headers: H(viewerA) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { units: unknown[] }).units.length).toBeGreaterThanOrEqual(2);

    // parentId inválido (não-UUID) → 400 schema
    const badParent = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Y', parentId: 'nao-uuid' } });
    expect(badParent.statusCode).toBe(400);
    // pai inexistente
    const ghost = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Y', parentId: '00000000-0000-4000-8000-000000000099' } });
    expect(ghost.statusCode, ghost.body).toBe(404);
    // pai de outro tenant: cria unidade no tenant B e tenta usar como pai no A
    const unitB = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorB), payload: { name: 'Unit B' } });
    const unitBId = (unitB.json() as { id: string }).id;
    const cross = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'Z', parentId: unitBId } });
    expect(cross.statusCode).toBe(404);
    // isolamento: lista do tenant A não traz unidades do B
    const listA = await app.inject({ method: 'GET', url: '/v1/units', headers: H(operatorA) });
    const namesA = JSON.stringify(listA.json());
    expect(namesA).not.toContain('Unit B');
  });

  it('MAX_UNIT_DEPTH: cadeia de 20 níveis ok; 21º nível → 422', async () => {
    const rootRes = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'D0' } });
    let parent = (rootRes.json() as { id: string }).id;
    for (let i = 1; i <= 19; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: `D${i}`, parentId: parent } });
      expect(res.statusCode, res.body).toBe(201);
      parent = (res.json() as { id: string }).id;
    }
    // parent agora está a 20 níveis (D0..D19); um filho dele teria depth 21 → 422
    const tooDeep = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'D20', parentId: parent } });
    expect(tooDeep.statusCode, tooDeep.body).toBe(422);
  });
});

describe('E05-A people + guardianships', () => {
  let unitId = '';
  let studentId = '';
  let guardianId = '';

  it('cria unidade, aluno e responsável; vincula; duplicata → 409', async () => {
    const unit = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorA), payload: { name: 'U1' } });
    unitId = (unit.json() as { id: string }).id;
    const student = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: 'Ana Silva', unitId } });
    expect(student.statusCode).toBe(201);
    studentId = (student.json() as { id: string }).id;
    const guardian = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'GUARDIAN', name: 'Bob Silva', unitId, email: 'bob@test' } });
    guardianId = (guardian.json() as { id: string }).id;

    const link = await app.inject({ method: 'POST', url: `/v1/people/${studentId}/guardians`, headers: H(operatorA), payload: { guardianId, relation: 'mother', isPrimary: true } });
    expect(link.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: `/v1/people/${studentId}/guardians`, headers: H(operatorA), payload: { guardianId, relation: 'mother' } });
    expect(dup.statusCode, dup.body).toBe(409);

    const list = await app.inject({ method: 'GET', url: `/v1/people/${studentId}/guardians`, headers: H(viewerA) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { guardians: { id: string }[] }).guardians[0]?.id).toBe(guardianId);
  });

  it('regras: kind errado → 422, auto-guardianship → 422, inativo → 422, cross-tenant → 404', async () => {
    const staff = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STAFF', name: 'Carol', unitId } });
    const staffId = (staff.json() as { id: string }).id;
    const badKind = await app.inject({ method: 'POST', url: `/v1/people/${studentId}/guardians`, headers: H(operatorA), payload: { guardianId: staffId, relation: 'x' } });
    expect(badKind.statusCode, badKind.body).toBe(422);
    const selfGuard = await app.inject({ method: 'POST', url: `/v1/people/${studentId}/guardians`, headers: H(operatorA), payload: { guardianId: studentId, relation: 'self' } });
    expect(selfGuard.statusCode, selfGuard.body).toBe(422);

    // desativa o guardião e tenta nova vinculação com outro aluno
    const deact = await app.inject({ method: 'PATCH', url: `/v1/people/${guardianId}`, headers: H(operatorA), payload: { active: false } });
    expect(deact.statusCode).toBe(200);
    const other = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: 'Outro Aluno', unitId } });
    const otherId = (other.json() as { id: string }).id;
    const inact = await app.inject({ method: 'POST', url: `/v1/people/${otherId}/guardians`, headers: H(operatorA), payload: { guardianId, relation: 'father' } });
    expect(inact.statusCode).toBe(422);
    await app.inject({ method: 'PATCH', url: `/v1/people/${guardianId}`, headers: H(operatorA), payload: { active: true } });

    // pessoa de outro tenant não é visível
    const unitB = await app.inject({ method: 'POST', url: '/v1/units', headers: H(operatorB), payload: { name: 'UB' } });
    const unitBId = (unitB.json() as { id: string }).id;
    const personB = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorB), payload: { kind: 'STUDENT', name: 'Tenant B Kid', unitId: unitBId } });
    const personBId = (personB.json() as { id: string }).id;
    const stolen = await app.inject({ method: 'GET', url: `/v1/people/${personBId}`, headers: H(operatorA) });
    expect(stolen.statusCode).toBe(404);
    // guardianship cross-tenant
    const crossGuard = await app.inject({ method: 'POST', url: `/v1/people/${studentId}/guardians`, headers: H(operatorA), payload: { guardianId: personBId, relation: 'x' } });
    expect(crossGuard.statusCode, crossGuard.body).toBe(404);
    // PATCH cross-tenant → 404 sem mutar
    const patchCross = await app.inject({ method: 'PATCH', url: `/v1/people/${personBId}`, headers: H(operatorA), payload: { name: 'Hackeado' } });
    expect(patchCross.statusCode).toBe(404);
    const stillB = await app.inject({ method: 'GET', url: `/v1/people/${personBId}`, headers: H(operatorB) });
    expect((stillB.json() as { name: string }).name).toBe('Tenant B Kid');
    // GET guardians de aluno externo → 404 (isola via tenant; lista vazia não basta pois id é de outro tenant)
    const guardCross = await app.inject({ method: 'GET', url: `/v1/people/${personBId}/guardians`, headers: H(operatorA) });
    expect(guardCross.statusCode).toBe(404);
    // POST person com unitId de outro tenant → 404
    const unitCross = await app.inject({ method: 'POST', url: '/v1/people', headers: H(operatorA), payload: { kind: 'STUDENT', name: 'Intruso', unitId: unitBId } });
    expect(unitCross.statusCode, unitCross.body).toBe(404);
    // filtro com unitId externo não vaza
    const filterCross = await app.inject({ method: 'GET', url: `/v1/people?unitId=${unitBId}`, headers: H(operatorA) });
    expect((filterCross.json() as { people: unknown[] }).people).toHaveLength(0);
  });

  it('viewer lê mas não escreve; filtros de busca funcionam', async () => {
    const denied = await app.inject({ method: 'POST', url: '/v1/people', headers: H(viewerA), payload: { kind: 'STUDENT', name: 'Nope', unitId } });
    expect(denied.statusCode).toBe(403);
    const search = await app.inject({ method: 'GET', url: '/v1/people?name=Ana', headers: H(viewerA) });
    expect(search.statusCode).toBe(200);
    const found = (search.json() as { people: { name: string }[] }).people;
    expect(found.some((p) => p.name === 'Ana Silva')).toBe(true);
    const byKind = await app.inject({ method: 'GET', url: '/v1/people?kind=GUARDIAN', headers: H(viewerA) });
    const guardians = (byKind.json() as { people: { kind: string }[] }).people;
    expect(guardians.every((p) => p.kind === 'GUARDIAN')).toBe(true);
    // kind inválido → 400 (schema estrito), não filtro silencioso
    const badKind = await app.inject({ method: 'GET', url: '/v1/people?kind=EMPERADOR', headers: H(viewerA) });
    expect(badKind.statusCode).toBe(400);
    // wildcards % e _ não enumeram: 'An%' não deve casar 'Ana Silva'
    const wildPct = await app.inject({ method: 'GET', url: '/v1/people?name=' + encodeURIComponent('An%'), headers: H(viewerA) });
    expect(((wildPct.json()) as { people: { name: string }[] }).people.some((p) => p.name === 'Ana Silva')).toBe(false);
    const wildUnd = await app.inject({ method: 'GET', url: '/v1/people?name=' + encodeURIComponent('An_ Silva'), headers: H(viewerA) });
    expect(((wildUnd.json()) as { people: { name: string }[] }).people.some((p) => p.name === 'Ana Silva')).toBe(false);
  });
});
