/**
 * E09-02 E2E — templates versionados, PII guard, revisão, preview (Postgres real).
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

describe('E09-02 templates', () => {
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool });
    token = await login('e0902@test.com', 'A');
    // def base (E09-01)
    const def = await app.inject({ method: 'POST', url: '/v1/comm-event-defs', headers: H(), payload: { eventKey: 'enrollment.created', channel: 'inapp', name: 'Matrícula', templateBody: 'x' } });
    expect(def.statusCode).toBe(201);
  }, 180_000);
  afterAll(async () => { await app?.close(); await db?.teardown(); });

  it('tenant isolation', async () => {
    const tB = await login('e0902b@test.com', 'B');
    const list = await app.inject({ method: 'GET', url: '/v1/comm-templates', headers: { authorization: `Bearer ${tB}` } });
    expect((list.json() as unknown[])).toHaveLength(0);
  });

  it('ciclo: draft → editar → approve (imutável) → v2 → preview; PII e placeholders rejeitados', async () => {
    // def inexistente → 404
    const noDef = await app.inject({ method: 'POST', url: '/v1/comm-templates', headers: H(), payload: {
      eventKey: 'outro.evento', channel: 'email', locale: 'pt',
      subject: 's', body: 'b', samplePayload: {},
    } });
    expect(noDef.statusCode).toBe(404);

    // PII (CPF) → 422
    const pii = await app.inject({ method: 'POST', url: '/v1/comm-templates', headers: H(), payload: {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 'Bem-vindo', body: 'CPF do aluno: 123.456.789-09', samplePayload: { student_name: 'A' },
    } });
    expect(pii.statusCode).toBe(422);
    // placeholder sem sample → 422
    const badPh = await app.inject({ method: 'POST', url: '/v1/comm-templates', headers: H(), payload: {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: 'Olá {{student_name}}', samplePayload: { outro: 'x' },
    } });
    expect(badPh.statusCode).toBe(422);
    // v1 draft válida
    const v1 = await app.inject({ method: 'POST', url: '/v1/comm-templates', headers: H(), payload: {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 'Bem-vindo {{student_name}}', body: 'Olá {{student_name}}, matrícula {{enrollment_id}} criada.',
      samplePayload: { student_name: 'Ana', enrollment_id: 'e-1' },
    } });
    expect(v1.statusCode).toBe(201);
    const v1Body = v1.json() as { id: string; version: number; status: string };
    expect(v1Body.version).toBe(1);
    expect(v1Body.status).toBe('DRAFT');
    // editar draft
    const edit = await app.inject({ method: 'PATCH', url: `/v1/comm-templates/${v1Body.id}`, headers: H(), payload: { body: 'Olá {{student_name}}! Matrícula {{enrollment_id}}.' } });
    expect(edit.statusCode).toBe(200);
    // approve
    const ap = await app.inject({ method: 'POST', url: `/v1/comm-templates/${v1Body.id}/approve`, headers: H(), payload: {} });
    expect(ap.statusCode).toBe(200);
    expect((ap.json() as { status: string }).status).toBe('APPROVED');
    // editar APPROVED → 422
    const edit2 = await app.inject({ method: 'PATCH', url: `/v1/comm-templates/${v1Body.id}`, headers: H(), payload: { body: 'mudança' } });
    expect(edit2.statusCode).toBe(422);
    // preview
    const pv = await app.inject({ method: 'POST', url: `/v1/comm-templates/${v1Body.id}/preview`, headers: H(), payload: { payload: { student_name: 'Bob', enrollment_id: 'e-9' } } });
    expect(pv.statusCode).toBe(200);
    expect(String(pv.body)).toContain('Bob');
    expect(String(pv.body)).not.toContain('{{');
    // preview com payload faltando variável → 422
    const pv2 = await app.inject({ method: 'POST', url: `/v1/comm-templates/${v1Body.id}/preview`, headers: H(), payload: { payload: { student_name: 'Bob' } } });
    expect(pv2.statusCode).toBe(422);
    // v2 (mesma def, nova versão)
    const v2 = await app.inject({ method: 'POST', url: '/v1/comm-templates', headers: H(), payload: {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 'Bem-vindo {{student_name}}', body: 'Olá {{student_name}}, tudo pronto!',
      samplePayload: { student_name: 'Ana' },
    } });
    expect(v2.statusCode).toBe(201);
    expect((v2.json() as { version: number }).version).toBe(2);
    // versões
    const vs = await app.inject({ method: 'GET', url: `/v1/comm-templates/${v1Body.id}/versions`, headers: H() });
    expect((vs.json() as unknown[])).toHaveLength(2);
  });

});
