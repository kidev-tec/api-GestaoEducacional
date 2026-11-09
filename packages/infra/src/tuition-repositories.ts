/**
 * E07-A — Repositórios de mensalidades. Toda query ESCOPADA por tenant.
 * Regras de domínio vivem aqui; ledger via postLedger (idempotente transacional).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { postLedger, getLedgerEntry } from './repositories.js';
import { NotFoundError, ConflictError, GuardianRuleError } from './people-repositories.js';

export interface TuitionPlanRow {
  id: string;
  tenantId: string;
  name: string;
  amountCents: number;
  dueDay: number;
  active: boolean;
}

export interface TuitionRow {
  id: string;
  tenantId: string;
  planId: string;
  studentId: string;
  reference: string;
  amountCents: number;
  dueDate: string;
  status: 'OPEN' | 'SETTLED' | 'CANCELED';
  ledgerEntryId: string | null;
}

const REFERENCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class TuitionRuleError extends Error {
  override name = 'TuitionRuleError';
}

type Q = { text: string; values?: unknown[] };

export async function insertPlan(
  client: Pool | PoolClient,
  params: { tenantId: string; name: string; amountCents: number; dueDay: number },
): Promise<TuitionPlanRow> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw new TuitionRuleError('amount must be positive integer cents');
  }
  if (!Number.isInteger(params.dueDay) || params.dueDay < 1 || params.dueDay > 12) {
    throw new TuitionRuleError('due day must be between 1 and 12');
  }
  const res = await client.query(
    'INSERT INTO tuition_plans (id, tenant_id, name, amount_cents, due_day) VALUES ($1,$2,$3,$4,$5) RETURNING id, tenant_id, name, amount_cents, due_day, active',
    [randomUUID(), params.tenantId, params.name, params.amountCents, params.dueDay],
  );
  const r = res.rows[0] as { id: string; tenant_id: string; name: string; amount_cents: number; due_day: number; active: boolean };
  return { id: r.id, tenantId: r.tenant_id, name: r.name, amountCents: Number(r.amount_cents), dueDay: Number(r.due_day), active: r.active };
}

export async function listPlans(pool: Pool, tenantId: string): Promise<TuitionPlanRow[]> {
  const res = await pool.query(
    'SELECT id, tenant_id, name, amount_cents, due_day, active FROM tuition_plans WHERE tenant_id = $1 AND active ORDER BY created_at, name',
    [tenantId],
  );
  return (res.rows as { id: string; tenant_id: string; name: string; amount_cents: number; due_day: number; active: boolean }[]).map((r) => ({
    id: r.id, tenantId: r.tenant_id, name: r.name, amountCents: Number(r.amount_cents), dueDay: Number(r.due_day), active: r.active,
  }));
}

export async function generateTuition(
  client: PoolClient,
  params: { tenantId: string; planId: string; studentId: string; reference: string; dueDate?: string },
): Promise<TuitionRow> {
  if (!REFERENCE_RE.test(params.reference)) throw new TuitionRuleError('reference must be YYYY-MM');
  const plan = await client.query(
    'SELECT id, tenant_id, name, amount_cents, due_day, active FROM tuition_plans WHERE id = $1 AND tenant_id = $2',
    [params.planId, params.tenantId],
  );
  if (!plan.rowCount) throw new NotFoundError('plan');
  const p = plan.rows[0] as { id: string; amount_cents: number; due_day: number; active: boolean };
  if (!p.active) throw new TuitionRuleError('plan inactive');

  const student = await client.query(
    'SELECT id, tenant_id, kind, active FROM people WHERE id = $1 AND tenant_id = $2',
    [params.studentId, params.tenantId],
  );
  if (!student.rowCount) throw new NotFoundError('student');
  const s = student.rows[0] as { kind: string; active: boolean };
  if (s.kind !== 'STUDENT') throw new TuitionRuleError('person must have kind STUDENT');
  if (!s.active) throw new TuitionRuleError('student inactive');

  const dup = await client.query(
    'SELECT id FROM tuitions WHERE tenant_id = $1 AND student_id = $2 AND reference = $3',
    [params.tenantId, params.studentId, params.reference],
  );
  if (dup.rowCount) throw new ConflictError('tuition already generated for this reference');

  const year = Number(params.reference.slice(0, 4));
  const month = Number(params.reference.slice(5, 7));
  const dueDate = params.dueDate ?? `${year}-${String(month).padStart(2, '0')}-${String(p.due_day).padStart(2, '0')}`;
  const amount = Number(p.amount_cents);

  const { entry } = await postLedger(client, {
    entryId: randomUUID(), tenantId: params.tenantId, type: 'CHARGE', amountCents: amount,
  });
  const res = await client.query(
    `INSERT INTO tuitions (id, tenant_id, plan_id, student_id, reference, amount_cents, due_date, status, ledger_entry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8)
     ON CONFLICT (tenant_id, student_id, reference) DO NOTHING
     RETURNING id, tenant_id, plan_id, student_id, reference, amount_cents, due_date, status, ledger_entry_id`,
    [randomUUID(), params.tenantId, params.planId, params.studentId, params.reference, amount, dueDate, entry.id],
  );
  if (!res.rowCount) throw new ConflictError('tuition already generated for this reference');
  return toTuition(res.rows[0]);
}

export async function settleTuition(
  client: PoolClient,
  params: { tenantId: string; tuitionId: string; paymentAmountCents: number; idempotencyKey: string },
): Promise<{ tuition: TuitionRow; ledgerEntryId: string }> {
  if (!Number.isInteger(params.paymentAmountCents) || params.paymentAmountCents <= 0) {
    throw new TuitionRuleError('payment must be positive integer cents');
  }
  const t = await getTuitionRow(client, params.tenantId, params.tuitionId, true);
  // Replay idempotente: se a tuition já está SETTLED com alocação da MESMA key, o PAYMENT
  // original é retornado (postLedger faria o mesmo); não é erro.
  if (t.status !== 'OPEN') {
    const prior = await client.query(
      `SELECT a.ledger_entry_id FROM payment_allocations a
       JOIN ledger_idempotency i ON i.entry_id = a.ledger_entry_id
       WHERE a.tenant_id = $1 AND a.tuition_id = $2 AND i.idempotency_key = $3`,
      [params.tenantId, params.tuitionId, params.idempotencyKey],
    );
    if (prior.rowCount) {
      const entryId = (prior.rows[0] as { ledger_entry_id: string }).ledger_entry_id;
      return { tuition: t, ledgerEntryId: entryId };
    }
    throw new TuitionRuleError(`tuition is ${t.status}, only OPEN can settle`);
  }
  if (params.paymentAmountCents !== t.amountCents) {
    throw new TuitionRuleError(`payment must exactly match tuition amount (${t.amountCents})`);
  }
  const { entry } = await postLedger(client, {
    entryId: randomUUID(), tenantId: params.tenantId, type: 'PAYMENT', amountCents: params.paymentAmountCents,
    idempotencyKey: params.idempotencyKey,
  });
  await client.query(
    'INSERT INTO payment_allocations (id, tenant_id, tuition_id, ledger_entry_id) VALUES ($1,$2,$3,$4) ON CONFLICT (ledger_entry_id) DO NOTHING',
    [randomUUID(), params.tenantId, params.tuitionId, entry.id],
  );
  const res = await client.query(
    "UPDATE tuitions SET status = 'SETTLED' WHERE id = $1 AND tenant_id = $2 AND status = 'OPEN' RETURNING id, tenant_id, plan_id, student_id, reference, amount_cents, due_date, status, ledger_entry_id",
    [params.tuitionId, params.tenantId],
  );
  return { tuition: toTuition(res.rows[0]), ledgerEntryId: entry.id };
}

export async function cancelTuition(client: PoolClient, tenantId: string, tuitionId: string): Promise<TuitionRow> {
  const t = await getTuitionRow(client, tenantId, tuitionId, true);
  if (t.status !== 'OPEN') throw new TuitionRuleError(`tuition is ${t.status}, only OPEN can cancel`);
  if (t.ledgerEntryId === null) throw new TuitionRuleError('tuition has no charge to reverse');
  await postLedger(client, {
    entryId: randomUUID(), tenantId, type: 'REVERSAL', amountCents: -t.amountCents, reverses: t.ledgerEntryId,
  });
  const res = await client.query(
    "UPDATE tuitions SET status = 'CANCELED' WHERE id = $1 AND tenant_id = $2 AND status = 'OPEN' RETURNING id, tenant_id, plan_id, student_id, reference, amount_cents, due_date, status, ledger_entry_id",
    [tuitionId, tenantId],
  );
  return toTuition(res.rows[0]);
}

export async function listTuitions(
  pool: Pool, tenantId: string,
  filter: { status?: TuitionRow['status']; studentId?: string; reference?: string } = {},
): Promise<TuitionRow[]> {
  const clauses = ['t.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.status) { values.push(filter.status); clauses.push(`t.status = $${values.length}`); }
  if (filter.studentId) { values.push(filter.studentId); clauses.push(`t.student_id = $${values.length}`); }
  if (filter.reference) { values.push(filter.reference); clauses.push(`t.reference = $${values.length}`); }
  const res = await pool.query(
    `SELECT t.id, t.tenant_id, t.plan_id, t.student_id, t.reference, t.amount_cents, t.due_date, t.status, t.ledger_entry_id
     FROM tuitions t WHERE ${clauses.join(' AND ')} ORDER BY t.created_at DESC`,
    values as never[],
  );
  return (res.rows as Record<string, unknown>[]).map(toTuition);
}

export async function getTuition(pool: Pool | PoolClient, tenantId: string, id: string): Promise<TuitionRow> {
  return getTuitionRow(clientLike(pool), tenantId, id);
}

async function getTuitionRow(
  client: PoolClient | { query: Pool['query'] },
  tenantId: string,
  id: string,
  forUpdate = false,
): Promise<TuitionRow> {
  const res = await client.query(
    `SELECT id, tenant_id, plan_id, student_id, reference, amount_cents, due_date, status, ledger_entry_id FROM tuitions WHERE id = $1 AND tenant_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, tenantId],
  );
  if (!res.rowCount) throw new NotFoundError('tuition');
  return toTuition(res.rows[0]);
}

function toTuition(r: Record<string, unknown>): TuitionRow {
  const due = r.due_date;
  // pg retorna DATE como Date (meia-noite LOCAL): formatar por partes locais, nunca toISOString (shift UTC)
  const d = due as Date;
  const dueDate = typeof due === 'string'
    ? due
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    planId: r.plan_id as string,
    studentId: r.student_id as string,
    reference: r.reference as string,
    amountCents: Number(r.amount_cents),
    dueDate,
    status: r.status as TuitionRow['status'],
    ledgerEntryId: (r.ledger_entry_id as string | null) ?? null,
  };
}

function clientLike(pool: Pool | PoolClient): { query: Pool['query'] } {
  return pool as unknown as { query: Pool['query'] };
}

export { getLedgerEntry, GuardianRuleError };
