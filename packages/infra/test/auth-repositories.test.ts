/**
 * E04-A — Testes unitários dos repositórios de auth com PoolClient fake.
 * Cobrem: hash de token determinístico, geração de token opaco, força de senha,
 * insertUser (sucesso/email duplicado), getUserByEmail (ache/não ache),
 * createSession, resolveSession (válida/expirada/revogada/inexistente/sem user)
 * e revokeSession idempotente.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertPasswordStrength,
  createSession,
  EmailTakenError,
  getUserByEmail,
  hashToken,
  insertUser,
  newSessionToken,
  resolveSession,
  revokeSession,
  SessionInvalidError,
  UserNotFoundError,
} from '../src/auth-repositories.js';

type Row = Record<string, unknown>;
/** PoolClient fake: queries enfileiradas respondem em ordem. */
function fakeClient(responses: { rows: Row[]; rowCount?: number | null }[]) {
  let i = 0;
  return {
    query: vi.fn(async () => responses[i++] ?? { rows: [], rowCount: 0 }),
  } as never as Parameters<typeof insertUser>[0];
}

describe('helpers de credencial', () => {
  it('hashToken é determinístico e diferente por token', () => {
    expect(hashToken('t1')).toBe(hashToken('t1'));
    expect(hashToken('t1')).not.toBe(hashToken('t2'));
    expect(hashToken('t1')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('newSessionToken gera base64url de 32 bytes', () => {
    expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(newSessionToken());
  });

  it('assertPasswordStrength rejeita curta e aceita >=10', () => {
    expect(() => assertPasswordStrength('short')).toThrow('at least 10');
    expect(() => assertPasswordStrength('long-enough-password')).not.toThrow();
  });
});

describe('insertUser', () => {
  const base = { id: 'u1', tenantId: 'A', email: 'a@x.test', passwordHash: '$argon2id$hash', role: 'viewer' as const };
  it('insere usuário novo e retorna linha normalizada', async () => {
    const client = fakeClient([
      { rows: [], rowCount: 0 },
      { rows: [{ id: 'u1', tenant_id: 'A', email: 'a@x.test', password_hash: '$argon2id$hash', role: 'viewer' }], rowCount: 1 },
    ]);
    const user = await insertUser(client, base);
    expect(user).toEqual({ id: 'u1', tenantId: 'A', email: 'a@x.test', passwordHash: '$argon2id$hash', role: 'viewer' });
  });

  it('lança EmailTakenError quando email já existe', async () => {
    const client = fakeClient([{ rows: [{ id: 'u0' }], rowCount: 1 }]);
    await expect(insertUser(client, base)).rejects.toBeInstanceOf(EmailTakenError);
  });
});

describe('getUserByEmail', () => {
  it('retorna usuário quando existe', async () => {
    const client = fakeClient([{ rows: [{ id: 'u1', tenant_id: 'A', email: 'a@x.test', password_hash: 'h', role: 'admin' }], rowCount: 1 }]);
    const user = await getUserByEmail(client, 'a@x.test');
    expect(user.role).toBe('admin');
  });

  it('lança UserNotFoundError uniforme quando não existe', async () => {
    const client = fakeClient([{ rows: [], rowCount: 0 }]);
    await expect(getUserByEmail(client, 'nada@x.test')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('createSession', () => {
  it('insere sessão com hash do token e retorna expiração', async () => {
    const client = fakeClient([{ rows: [{ id: 's1', user_id: 'u1', expires_at: '2026-11-10T00:00:00Z' }], rowCount: 1 }]);
    const session = await createSession(client, { id: 's1', userId: 'u1', token: 'tok', ttlMs: 1000 });
    expect(session.userId).toBe('u1');
    expect(session.expiresAt).toBeInstanceOf(Date);
  });
});

describe('resolveSession', () => {
  const poolQuery = vi.fn();
  const pool = { query: poolQuery } as never as Parameters<typeof resolveSession>[0];
  const sessionRow = { id: 's1', user_id: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null };

  it('retorna sessão+usuário válidos e atualiza last_seen', async () => {
    poolQuery.mockReset();
    poolQuery.mockImplementationOnce(async () => ({ rows: [sessionRow], rowCount: 1 }))
      .mockImplementationOnce(async () => ({ rowCount: 1 }))
      .mockImplementationOnce(async () => ({ rows: [{ id: 'u1', tenant_id: 'A', email: 'a@x.test', password_hash: 'h', role: 'operator' }], rowCount: 1 }));
    const { session, user } = await resolveSession(pool, 'tok');
    expect(session.id).toBe('s1');
    expect(user.role).toBe('operator');
    expect(poolQuery).toHaveBeenCalledTimes(3);
  });

  it('lança SessionInvalidError para token inexistente', async () => {
    poolQuery.mockReset();
    poolQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));
    await expect(resolveSession(pool, 'bad')).rejects.toBeInstanceOf(SessionInvalidError);
  });

  it.each([
    ['revogada', { ...sessionRow, revoked_at: new Date().toISOString() }],
    ['expirada', { ...sessionRow, expires_at: new Date(Date.now() - 1000).toISOString() }],
  ])('lança SessionInvalidError para sessão %s', async (_label, row) => {
    poolQuery.mockReset();
    poolQuery.mockImplementationOnce(async () => ({ rows: [row], rowCount: 1 }));
    await expect(resolveSession(pool, 'tok')).rejects.toBeInstanceOf(SessionInvalidError);
  });

  it('lança SessionInvalidError quando usuário da sessão não existe mais', async () => {
    poolQuery.mockReset();
    poolQuery.mockImplementationOnce(async () => ({ rows: [sessionRow], rowCount: 1 }))
      .mockImplementationOnce(async () => ({ rowCount: 1 }))
      .mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));
    await expect(resolveSession(pool, 'tok')).rejects.toBeInstanceOf(SessionInvalidError);
  });
});

describe('revokeSession', () => {
  it('revoga por hash do token (idempotente via revoked_at IS NULL)', async () => {
    const poolQuery = vi.fn(async () => ({ rowCount: 1 }));
    const pool = { query: poolQuery } as never as Parameters<typeof revokeSession>[0];
    await revokeSession(pool, 'tok');
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('revoked_at IS NULL'), [hashToken('tok')]);
  });
});
