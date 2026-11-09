/**
 * E04-A — Repositórios de autenticação (users + sessions).
 * Segurança por design:
 * - senha NUNCA sai daqui como plaintext (hash argon2id feito pelo caller);
 * - token de sessão NUNCA é persistido — só o SHA-256 dele;
 * - erros de credencial são uniformes (UserNotFoundError) para não revelar
 *   existência de email; timing-safe no nível do app (hash dummy).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'operator' | 'viewer';
}

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: Date;
}

export class UserNotFoundError extends Error {
  override name = 'UserNotFoundError';
  constructor() {
    super('invalid credentials');
  }
}

export class EmailTakenError extends Error {
  override name = 'EmailTakenError';
  constructor() {
    super('email already registered');
  }
}

export class SessionInvalidError extends Error {
  override name = 'SessionInvalidError';
  constructor() {
    super('invalid credentials');
  }
}

/** SHA-256 do token — a única forma de persistir credencial de sessão. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token opaco de sessão: 32 bytes aleatórios, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('password must be at least 10 characters');
  }
}

export async function insertUser(
  client: Pool | PoolClient,
  params: { id: string; tenantId: string; email: string; passwordHash: string; role: UserRow['role'] },
): Promise<UserRow> {
  const dup = await client.query('SELECT id FROM users WHERE email = $1', [params.email]);
  if (dup.rowCount) throw new EmailTakenError();
  const res = await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tenant_id, email, password_hash, role`,
    [params.id, params.tenantId, params.email, params.passwordHash, params.role],
  );
  const r = res.rows[0] as { id: string; tenant_id: string; email: string; password_hash: string; role: UserRow['role'] };
  return { id: r.id, tenantId: r.tenant_id, email: r.email, passwordHash: r.password_hash, role: r.role };
}

/** Busca usuário por email. Lança UserNotFoundError (uniforme) se inexistente. */
export async function getUserByEmail(client: Pool | PoolClient, email: string): Promise<UserRow> {
  const res = await client.query(
    'SELECT id, tenant_id, email, password_hash, role FROM users WHERE email = $1',
    [email],
  );
  if (!res.rowCount) throw new UserNotFoundError();
  const r = res.rows[0] as { id: string; tenant_id: string; email: string; password_hash: string; role: UserRow['role'] };
  return { id: r.id, tenantId: r.tenant_id, email: r.email, passwordHash: r.password_hash, role: r.role };
}

export async function createSession(
  client: Pool | PoolClient,
  params: { id: string; userId: string; token: string; ttlMs: number },
): Promise<SessionInfo> {
  const tokenHash = hashToken(params.token);
  const expiresAt = new Date(Date.now() + params.ttlMs);
  const res = await client.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at`,
    [params.id, params.userId, tokenHash, expiresAt],
  );
  const r = res.rows[0] as { id: string; user_id: string; expires_at: Date };
  return { id: r.id, userId: r.user_id, expiresAt: new Date(r.expires_at) };
}

/**
 * Resolve sessão válida a partir do token bruto. Revogada/expirada/inexistente →
 * SessionInvalidError (mesma mensagem uniforme). Atualiza last_seen_at.
 */
export async function resolveSession(
  pool: Pool,
  token: string,
): Promise<{ session: SessionInfo; user: UserRow }> {
  const tokenHash = hashToken(token);
  const res = await pool.query(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at
     FROM sessions s WHERE s.token_hash = $1`,
    [tokenHash],
  );
  if (!res.rowCount) throw new SessionInvalidError();
  const s = res.rows[0] as { id: string; user_id: string; expires_at: Date; revoked_at: Date | null };
  if (s.revoked_at !== null || new Date(s.expires_at).getTime() <= Date.now()) {
    throw new SessionInvalidError();
  }
  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  const u = await pool.query(
    'SELECT id, tenant_id, email, password_hash, role FROM users WHERE id = $1',
    [s.user_id],
  );
  if (!u.rowCount) throw new SessionInvalidError();
  const ur = u.rows[0] as { id: string; tenant_id: string; email: string; password_hash: string; role: UserRow['role'] };
  return {
    session: { id: s.id, userId: s.user_id, expiresAt: new Date(s.expires_at) },
    user: { id: ur.id, tenantId: ur.tenant_id, email: ur.email, passwordHash: ur.password_hash, role: ur.role },
  };
}

/** Logout: revogação imediata. Idempotente (revogar sessão já revogada = ok). */
export async function revokeSession(pool: Pool, token: string): Promise<void> {
  await pool.query(
    'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
}
