/**
 * Repositórios Postgres dos domínios — toda query ESCOPADA por tenant.
 * Idempotência de ledger garantida pelo UNIQUE (tenant_id, idempotency_key)
 * + ON CONFLICT (defesa final contra concorrência).
 */
import { Pool, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';

/** Hash estável de (tenant, key) → string numérica p/ pg_advisory_xact_lock (bigint PG). */
function hashLock(tenantId: string, key: string): string {
  const h = createHash('sha256').update(`${tenantId}:${key}`).digest();
  return (h.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    releaseOnce();
    return result;
  } catch (e) {
    // ROLLBACK nunca esconde o erro original: falha de rollback é absorvida
    // (.catch) e o erro real propaga; releaseOnce libera o client nos dois caminhos.
    await client.query('ROLLBACK').catch(() => {});
    releaseOnce();
    throw e;
  }
}

export interface LedgerRow {
  id: string;
  tenantId: string;
  type: 'CHARGE' | 'PAYMENT' | 'REVERSAL';
  amountCents: number;
  reverses: string | null;
}

/**
 * Post de ledger com idempotência transacional:
 * - UNIQUE (tenant_id, idempotency_key) resolve concorrência no banco
 * - mesmo payload → retorna o original; payload diferente → conflito
 */
export async function postLedger(
  client: PoolClient,
  params: {
    entryId: string;
    tenantId: string;
    type: 'CHARGE' | 'PAYMENT' | 'REVERSAL';
    amountCents: number;
    reverses?: string;
    idempotencyKey?: string;
  },
): Promise<{ entry: LedgerRow; idempotentReplay: boolean }> {
  if (!Number.isInteger(params.amountCents)) {
    throw new Error(`Money must be integer cents, got ${params.amountCents}`);
  }

  if (params.idempotencyKey) {
    // lock advisory por (tenant, key): serializa a corrida ANTES do SELECT,
    // evitando a race de INSERT paralelo (defesa 1; unique index é a defesa 2)
    const lockKey = hashLock(params.tenantId, params.idempotencyKey);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    const existing = await client.query(
      'SELECT entry_id, fingerprint FROM ledger_idempotency WHERE tenant_id = $1 AND idempotency_key = $2',
      [params.tenantId, params.idempotencyKey],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0] as { entry_id: string; fingerprint: string };
      const fingerprint = JSON.stringify([params.type, params.amountCents, params.reverses ?? null]);
      if (row.fingerprint !== fingerprint) {
        throw new Error(`idempotency key ${params.idempotencyKey} reused with different payload`);
      }
      const entry = await getLedgerEntry(client, row.entry_id, params.tenantId);
      return { entry, idempotentReplay: true };
    }
  }

  // reversões validadas dentro da transação (SELECT ... FOR UPDATE no original)
  if (params.reverses) {
    const original = await client.query(
      'SELECT type, amount_cents, tenant_id FROM ledger_entries WHERE id = $1 FOR UPDATE',
      [params.reverses],
    );
    if (!original.rowCount || (original.rows[0] as { tenant_id: string }).tenant_id !== params.tenantId) {
      throw new Error('reversal must reference the original entry');
    }
    const orig = original.rows[0] as { type: string; amount_cents: number };
    if (orig.type === 'REVERSAL') {
      throw new Error('cannot reverse a reversal; reverse the original CHARGE/PAYMENT');
    }
    if (params.amountCents !== -orig.amount_cents) {
      throw new Error('reversal amount must exactly negate the original entry');
    }
  }

  const inserted = await client.query(
    `INSERT INTO ledger_entries (id, tenant_id, type, amount_cents, reverses)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, tenant_id, type, amount_cents, reverses`,
    [params.entryId, params.tenantId, params.type, params.amountCents, params.reverses ?? null],
  );
  const row = inserted.rows[0] as LedgerRow;
  const entry: LedgerRow = {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    amountCents: Number(row.amountCents),
    reverses: row.reverses,
  };

  if (params.idempotencyKey) {
    const fingerprint = JSON.stringify([params.type, params.amountCents, params.reverses ?? null]);
    await client.query(
      `INSERT INTO ledger_idempotency (tenant_id, idempotency_key, entry_id, fingerprint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [params.tenantId, params.idempotencyKey, entry.id, fingerprint],
    );
  }

  await client.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1, $2, $3, $4, $5)',
    [params.tenantId, 'system', `ledger.${params.type.toLowerCase()}`, 'ledger-entry', entry.id],
  );

  return { entry, idempotentReplay: false };
}

export async function getLedgerEntry(
  client: PoolClient,
  id: string,
  tenantId: string,
): Promise<LedgerRow> {
  const res = await client.query(
    'SELECT id, tenant_id, type, amount_cents, reverses FROM ledger_entries WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (!res.rowCount) throw new Error(`ledger entry ${id} not found`);
  const row = res.rows[0] as LedgerRow;
  return { ...row, amountCents: Number(row.amountCents) };
}

export async function ledgerBalance(client: PoolClient | Pool, tenantId: string): Promise<number> {
  const res = await client.query(
    'SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM ledger_entries WHERE tenant_id = $1',
    [tenantId],
  );
  return Number((res.rows[0] as { balance: string }).balance);
}

export interface EnrollmentRow {
  id: string;
  tenantId: string;
  studentId: string;
  offerId: string;
  state: string;
}

const VALID_STATES = ['DRAFT', 'PENDING_DOCUMENTS', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELED', 'REJECTED'] as const;
type State = (typeof VALID_STATES)[number];
const TRANSITIONS: Record<string, readonly State[]> = {
  DRAFT: ['PENDING_DOCUMENTS', 'CANCELED', 'REJECTED'],
  PENDING_DOCUMENTS: ['PENDING_APPROVAL', 'CANCELED'],
  PENDING_APPROVAL: ['ACTIVE', 'CANCELED', 'REJECTED'],
  ACTIVE: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
  REJECTED: [],
};

export async function createEnrollment(
  client: PoolClient,
  params: {
    id: string;
    tenantId: string;
    studentId: string;
    offerId: string;
    idempotencyKey: string;
  },
): Promise<{ enrollment: EnrollmentRow; idempotentReplay: boolean }> {
  const fingerprint = JSON.stringify([params.tenantId, params.studentId, params.offerId]);
  const existing = await client.query(
    'SELECT enrollment_id, fingerprint FROM enrollment_idempotency WHERE tenant_id = $1 AND idempotency_key = $2',
    [params.tenantId, params.idempotencyKey],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    const row = existing.rows[0] as { enrollment_id: string; fingerprint: string };
    if (row.fingerprint !== fingerprint) {
      throw new Error(`idempotency key ${params.idempotencyKey} reused with different payload`);
    }
    const enrollment = await getEnrollment(client, row.enrollment_id, params.tenantId);
    return { enrollment, idempotentReplay: true };
  }

  const inserted = await client.query(
    `INSERT INTO enrollments (id, tenant_id, student_id, offer_id, state)
     VALUES ($1, $2, $3, $4, 'DRAFT') RETURNING id, tenant_id, student_id, offer_id, state`,
    [params.id, params.tenantId, params.studentId, params.offerId],
  );
  const row0 = inserted.rows[0] as unknown as EnrollmentRow & { tenant_id: string; student_id: string; offer_id: string };
  const enrollment: EnrollmentRow = {
    id: row0.id, tenantId: row0.tenant_id, studentId: row0.student_id, offerId: row0.offer_id, state: row0.state,
  };
  await client.query(
    'INSERT INTO enrollment_idempotency (tenant_id, idempotency_key, enrollment_id, fingerprint) VALUES ($1, $2, $3, $4)',
    [params.tenantId, params.idempotencyKey, enrollment.id, fingerprint],
  );
  await client.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1, $2, $3, $4, $5)',
    [params.tenantId, 'system', 'enrollment.create', 'enrollment', enrollment.id],
  );
  return { enrollment, idempotentReplay: false };
}

export async function transitionEnrollment(
  client: PoolClient,
  params: { id: string; to: State; tenantId: string; actorId: string },
): Promise<EnrollmentRow> {
  const current = await client.query(
    'SELECT state FROM enrollments WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [params.id, params.tenantId],
  );
  if (!current.rowCount) throw new Error(`enrollment ${params.id} not found`);
  const from = (current.rows[0] as { state: State }).state;
  if (!TRANSITIONS[from]?.includes(params.to)) {
    throw new Error(`invalid enrollment transition ${from} -> ${params.to}`);
  }
  const updated = await client.query(
    'UPDATE enrollments SET state = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id, tenant_id, student_id, offer_id, state',
    [params.to, params.id, params.tenantId],
  );
  await client.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1, $2, $3, $4, $5)',
    [params.tenantId, params.actorId, `enrollment.transition.${params.to}`, 'enrollment', params.id],
  );
  const u = updated.rows[0] as unknown as EnrollmentRow & { tenant_id: string; student_id: string; offer_id: string };
  return { id: u.id, tenantId: u.tenant_id, studentId: u.student_id, offerId: u.offer_id, state: u.state };
}

export async function getEnrollment(
  client: PoolClient | Pool,
  id: string,
  tenantId: string,
): Promise<EnrollmentRow> {
  const res = await client.query(
    'SELECT id, tenant_id, student_id, offer_id, state FROM enrollments WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (!res.rowCount) throw new Error(`enrollment ${id} not found`);
  const r = res.rows[0] as unknown as EnrollmentRow & { tenant_id: string; student_id: string; offer_id: string };
  return { id: r.id, tenantId: r.tenant_id, studentId: r.student_id, offerId: r.offer_id, state: r.state };
}

export async function auditCount(client: PoolClient | Pool, tenantId: string): Promise<number> {
  const res = await client.query(
    'SELECT COUNT(*) AS n FROM audit_records WHERE tenant_id = $1',
    [tenantId],
  );
  return Number((res.rows[0] as { n: string }).n);
}
