import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import {
  assertPasswordStrength,
  createSession,
  getUserByEmail,
  insertUser,
  newSessionToken,
  resolveSession,
  revokeSession,
  SessionInvalidError,
  UserNotFoundError,
  type UserRow,
} from '../../../packages/infra/src/auth-repositories.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c3RhdGljLWR1bW15LXNhbHQ$hyBSuhme4ywZE+LZFeRdMhxoObJqR5NTiN0dtWGa/qM';
type PublicUser = Pick<UserRow, 'id' | 'tenantId' | 'email' | 'role'>;

export type AuthenticatedRequest = FastifyRequest & { user: PublicUser };

function publicUser(user: UserRow): PublicUser {
  return { id: user.id, tenantId: user.tenantId, email: user.email, role: user.role };
}

function bearer(request: FastifyRequest): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function authenticateLogin(pool: Pool, email: string, password: string): Promise<UserRow> {
  let user: UserRow | undefined;
  try {
    user = await getUserByEmail(pool, email.toLowerCase());
  } catch (error) {
    if (!(error instanceof UserNotFoundError)) throw error;
  }
  // Sempre verifica hash: mitiga enumeração via timing para email inexistente.
  const valid = await argon2.verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
  if (!user || !valid) throw new SessionInvalidError();
  return user;
}

export async function requireAuth(pool: Pool, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(request);
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const { user } = await resolveSession(pool, token);
    (request as AuthenticatedRequest).user = publicUser(user);
  } catch (error) {
    if (error instanceof SessionInvalidError) return reply.code(401).send({ error: 'unauthorized' });
    throw error;
  }
}

export function requireRole(...roles: PublicUser['role'][]): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const user = (request as AuthenticatedRequest).user;
    if (!user || !roles.includes(user.role)) await reply.code(403).send({ error: 'forbidden' });
  };
}

export async function registerUser(
  pool: Pool,
  input: { tenantId: string; email: string; password: string; role: UserRow['role'] },
): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  const user = await insertUser(pool, {
    id: randomUUID(), tenantId: input.tenantId, email: input.email.toLowerCase(), passwordHash, role: input.role,
  });
  return publicUser(user);
}

export async function loginUser(pool: Pool, email: string, password: string): Promise<{ token: string; expiresAt: string; user: PublicUser }> {
  const user = await authenticateLogin(pool, email, password);
  const token = newSessionToken();
  const session = await createSession(pool, { id: randomUUID(), userId: user.id, token, ttlMs: SESSION_TTL_MS });
  return { token, expiresAt: session.expiresAt.toISOString(), user: publicUser(user) };
}

export async function logoutUser(pool: Pool, request: FastifyRequest): Promise<void> {
  const token = bearer(request);
  if (token) await revokeSession(pool, token);
}
