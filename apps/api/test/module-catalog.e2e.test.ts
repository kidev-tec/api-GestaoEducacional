/**
 * E13-01 E2E — catálogo de módulos com seed, dependências, ciclo (Postgres real).
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

describe('E13-01 catálogo de módulos', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e1301@test.com', 'A');
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('seed idempotente com 9 módulos; cria/atualiza/dependentes; regras adversariais', async () => {
    // seed da migration presente
    const list = await app.inject({ method: 'GET', url: '/v1/modules', headers: H() });
    const mods = list.json() as Array<{ key: string; tier: string; priceCents: number; requires: string[]; active: boolean }>;
    expect(mods.map((m) => m.key).sort()).toEqual(['academico', 'bi', 'core', 'crm', 'financeiro', 'ia', 'mensageria', 'portais', 'secretaria']);
    const core = mods.find((m) => m.key === 'core')!;
    expect(core.tier).toBe('FREE');
    expect(core.priceCents).toBe(0);
    const ia = mods.find((m) => m.key === 'ia')!;
    expect(ia.requires).toEqual(['bi']);
    // dependente de bi → ia
    const deps = await app.inject({ method: 'GET', url: '/v1/modules/bi/dependents', headers: H() });
    expect(deps.json() as string[]).toContain('ia');
    // FREE com preço → 422
    const badFree = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'livre', name: 'L', tier: 'FREE', priceCents: 500, requires: [] } });
    expect(badFree.statusCode).toBe(422);
    // slug inválido → 422 (regex no src; AJV aceita string)
    const badSlug = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'Bad Key', name: 'X', tier: 'PAID', priceCents: 100, requires: [] } });
    expect(badSlug.statusCode).toBe(422);
    // dependência inexistente → 422
    const ghost = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'novo', name: 'X', tier: 'PAID', priceCents: 100, requires: ['ghost'] } });
    expect(ghost.statusCode).toBe(422);
    // duplicado → 409 (unique violation)
    const dup = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'core', name: 'Core2', tier: 'FREE', priceCents: 0, requires: [] } });
    expect(dup.statusCode).toBe(409);
    // criar módulo novo válido
    const ok = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'addon_teste', name: 'Addon', tier: 'PAID', priceCents: 5000, requires: ['crm'] } });
    expect(ok.statusCode).toBe(201);
    // update: desativar crm → dependente addon_teste fica órfão? desativar não muda requires, só active.
    const off = await app.inject({ method: 'PATCH', url: '/v1/modules/crm', headers: H(), payload: { active: false } });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { active: boolean }).active).toBe(false);
    // novo módulo requerendo crm inativo → 422
    const depOff = await app.inject({ method: 'POST', url: '/v1/modules', headers: H(), payload: { key: 'outro', name: 'O', tier: 'PAID', priceCents: 100, requires: ['crm'] } });
    expect(depOff.statusCode).toBe(422);
    // reativar
    await app.inject({ method: 'PATCH', url: '/v1/modules/crm', headers: H(), payload: { active: true } });
    // ciclo: secretaria requerendo academico→secretaria? academico requer secretaria; secretaria requer academico = ciclo
    const cyc = await app.inject({ method: 'PATCH', url: '/v1/modules/secretaria', headers: H(), payload: { requires: ['academico'] } });
    expect(cyc.statusCode).toBe(422);
    // 404
    const nf = await app.inject({ method: 'PATCH', url: '/v1/modules/zzz', headers: H(), payload: { active: false } });
    expect(nf.statusCode).toBe(404);
  });
});
