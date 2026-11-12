/**
 * E03-A — Outbox persistente: at-least-once com dedupe por eventId.
 * Enfileirar acontece na MESMA transação da escrita de negócio (caller garante).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface OutboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly version: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly processedAt: string | null;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
}

export class OutboxRuleError extends Error {}
export class OutboxConflictError extends Error {}

const MAX_ATTEMPTS = 5;
export const DLQ_ATTEMPTS = MAX_ATTEMPTS;

type Q = { text: string; values?: unknown[] };

/** Enfileira evento; id idêntico reprocessado é idempotente (retorna existente). */
export async function enqueueOutbox(
  client: PoolClient | { query: Pool['query'] },
  params: { tenantId: string; type: string; version: string; payload?: unknown; eventId?: string },
  now = new Date().toISOString(),
): Promise<OutboxRow> {
  if (!params.type) throw new OutboxRuleError('type required');
  if (!/^\d+\.\d+\.\d+$/.test(params.version)) throw new OutboxRuleError('version must be semver-ish X.Y.Z');
  const id = params.eventId ?? randomUUID();
  const res = await client.query(
    `INSERT INTO outbox_events (id, tenant_id, type, version, payload, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at`,
    [id, params.tenantId, params.type, params.version, JSON.stringify(params.payload ?? {}), now],
  );
  if (res.rowCount) return toOutbox(res.rows[0] as Record<string, unknown>);
  // replay: evento com mesmo id já existe — retornar o original (idempotência)
  const existing = await client.query(
    'SELECT id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at FROM outbox_events WHERE id = $1 AND tenant_id = $2',
    [id, params.tenantId],
  );
  if (!existing.rowCount) throw new OutboxConflictError(`outbox id ${id} taken by another tenant`);
  return toOutbox(existing.rows[0] as Record<string, unknown>);
}

/**
 * Claim at-least-once: seleciona pendentes com FOR UPDATE SKIP LOCKED e agenda
 * next_attempt_at (backoff) para que o crash do worker não perca o evento —
 * passada a janela, outro claim pode repegá-lo (reentrega possível = at-least-once).
 */
export async function claimPending(
  pool: Pool | PoolClient,
  params: { limit: number; backoffMs?: number },
): Promise<OutboxRow[]> {
  if (!Number.isInteger(params.limit) || params.limit <= 0 || params.limit > 100) {
    throw new OutboxRuleError('limit must be integer 1..100');
  }
  const backoffMs = params.backoffMs ?? 30_000;
  const client = await (pool as Pool).connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at
       FROM outbox_events
       WHERE processed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND attempts < $1
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS, params.limit],
    );
    const ids = (res.rows as Record<string, unknown>[]).map((r) => r.id as string);
    if (ids.length) {
      await client.query(
        'UPDATE outbox_events SET next_attempt_at = now() + ($1::text::interval) WHERE id = ANY($2) AND processed_at IS NULL',
        [`${backoffMs} milliseconds`, ids],
      );
    }
    await client.query('COMMIT');
    client.release();
    return (res.rows as Record<string, unknown>[]).map(toOutbox);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw e;
  }
}

/** Marca processado — o dedupe definitivo: reentregas subsequentes são puladas. */
export async function markProcessed(client: PoolClient | { query: Pool['query'] }, tenantId: string, id: string): Promise<OutboxRow> {
  const res = await client.query(
    'UPDATE outbox_events SET processed_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at',
    [id, tenantId],
  );
  if (!res.rowCount) throw new OutboxRuleError(`outbox event ${id} not found`);
  return toOutbox(res.rows[0] as Record<string, unknown>);
}

/** Handler falhou: attempts++, backoff exponencial; DLQ quando attempts >= MAX. */
export async function failAttempt(client: PoolClient | { query: Pool['query'] }, tenantId: string, id: string, backoffMs = 5_000): Promise<OutboxRow> {
  const res = await client.query(
    `UPDATE outbox_events
     SET attempts = attempts + 1,
         next_attempt_at = CASE WHEN attempts + 1 >= $3 THEN NULL ELSE now() + ($4::text::interval) END
     WHERE id = $1 AND tenant_id = $2 AND processed_at IS NULL
     RETURNING id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at`,
    [id, tenantId, MAX_ATTEMPTS, `${backoffMs * 2} milliseconds`],
  );
  if (!res.rowCount) throw new OutboxRuleError(`outbox event ${id} not found or already processed`);
  return toOutbox(res.rows[0] as Record<string, unknown>);
}

export async function listOutbox(
  pool: Pool, tenantId: string,
  filter: { status?: 'pending' | 'processed' | 'dlq' } = {},
): Promise<OutboxRow[]> {
  const clauses = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.status === 'pending') { clauses.push('processed_at IS NULL AND attempts < $2'); values.push(MAX_ATTEMPTS); }
  if (filter.status === 'processed') clauses.push('processed_at IS NOT NULL');
  if (filter.status === 'dlq') { clauses.push('processed_at IS NULL AND attempts >= $2'); values.push(MAX_ATTEMPTS); }
  const res = await pool.query(
    `SELECT id, tenant_id, type, version, payload, created_at, processed_at, attempts, next_attempt_at
     FROM outbox_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values as never[],
  );
  return (res.rows as Record<string, unknown>[]).map(toOutbox);
}

export function isDlq(r: Pick<OutboxRow, 'processedAt' | 'attempts'>): boolean {
  return r.processedAt === null && r.attempts >= MAX_ATTEMPTS;
}

function toOutbox(r: Record<string, unknown>): OutboxRow {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    type: r.type as string,
    version: r.version as string,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    createdAt: iso(r.created_at),
    processedAt: r.processed_at === null ? null : iso(r.processed_at),
    attempts: Number(r.attempts),
    nextAttemptAt: r.next_attempt_at === null || r.next_attempt_at === undefined ? null : iso(r.next_attempt_at),
  };
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

// re-export p/ workers saberem o tipo sem importar internals
export type { Q as OutboxQuery };
