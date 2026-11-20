/**
 * E06-CONTRACT: repositório de contratos escolares (idempotente, cross-tenant safe).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { NotFoundError, ConflictError } from './people-repositories.js';
import { withTransaction } from './repositories.js';
import { generateTuition, cancelTuition } from './tuition-repositories.js';

export interface SchoolContractRow {
  id: string; tenantId: string; enrollmentId: string; planId: string;
  monthlyPriceCents: number; installments: number; startReference: string;
  status: 'DRAFT' | 'ACTIVE' | 'CANCELED'; createdBy: string;
}

export class ContractRuleError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ContractRuleError'; }
}

const SELECT = `SELECT id, tenant_id, enrollment_id, plan_id, monthly_price_cents, installments, start_reference, status, created_by
  FROM school_contracts`;

type Row = { id: string; tenant_id: string; enrollment_id: string; plan_id: string; monthly_price_cents: number; installments: number; start_reference: string; status: string; created_by: string };
const toRow = (r: Row): SchoolContractRow => ({
  id: r.id, tenantId: r.tenant_id, enrollmentId: r.enrollment_id, planId: r.plan_id,
  monthlyPriceCents: Number(r.monthly_price_cents), installments: Number(r.installments),
  startReference: r.start_reference, status: r.status as SchoolContractRow['status'], createdBy: r.created_by,
});

export function validateContractInput(input: { monthlyPriceCents: number; installments: number; startReference: string }): void {
  if (!Number.isInteger(input.monthlyPriceCents) || input.monthlyPriceCents <= 0) throw new ContractRuleError('monthlyPriceCents must be a positive integer');
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 12) throw new ContractRuleError('installments must be 1..12');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startReference)) throw new ContractRuleError('startReference must be YYYY-MM');
}

export function nextReference(ref: string, n: number): string {
  const y = Number(ref.slice(0, 4)); const m = Number(ref.slice(5, 7));
  const t = y * 12 + (m - 1) + n;
  const yy = Math.floor(t / 12); const mm = (t % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

export async function createSchoolContract(
  client: PoolClient,
  params: { tenantId: string; enrollmentId: string; planId: string; monthlyPriceCents: number; installments: number; startReference: string; createdBy: string; idempotencyKey: string },
): Promise<{ contract: SchoolContractRow; idempotentReplay: boolean }> {
  validateContractInput(params);
  const enr = await client.query("SELECT id FROM enrollments WHERE id = $1 AND tenant_id = $2 AND state = 'ACTIVE'", [params.enrollmentId, params.tenantId]);
  if (!enr.rowCount) {
    const any = await client.query('SELECT id FROM enrollments WHERE id = $1 AND tenant_id = $2', [params.enrollmentId, params.tenantId]);
    if (!any.rowCount) throw new NotFoundError('enrollment');
    throw new ContractRuleError('enrollment must be ACTIVE');
  }
  const plan = await client.query('SELECT id FROM tuition_plans WHERE id = $1 AND tenant_id = $2', [params.planId, params.tenantId]);
  if (!plan.rowCount) throw new NotFoundError('plan');

  const dup = await client.query(
    `SELECT contract_id, enrollment_id, plan_id, monthly_price_cents, installments, start_reference FROM school_contract_idempotency
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [params.tenantId, params.idempotencyKey],
  );
  if (dup.rowCount) {
    const r = dup.rows[0] as { contract_id: string; enrollment_id: string; plan_id: string; monthly_price_cents: number; installments: number; start_reference: string };
    const same = r.enrollment_id === params.enrollmentId && r.plan_id === params.planId
      && Number(r.monthly_price_cents) === params.monthlyPriceCents && Number(r.installments) === params.installments && r.start_reference === params.startReference;
    if (!same) throw new ConflictError('idempotency key already used with different payload');
    const existing = await getSchoolContract(client, params.tenantId, r.contract_id);
    return { contract: existing, idempotentReplay: true };
  }

  const res = await client.query(
    `INSERT INTO school_contracts (id, tenant_id, enrollment_id, plan_id, monthly_price_cents, installments, start_reference, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8)
     ON CONFLICT DO NOTHING
     RETURNING id, tenant_id, enrollment_id, plan_id, monthly_price_cents, installments, start_reference, status, created_by`,
    [randomUUID(), params.tenantId, params.enrollmentId, params.planId, params.monthlyPriceCents, params.installments, params.startReference, params.createdBy],
  );
  if (!res.rowCount) throw new ConflictError('enrollment already has an open contract');
  const contract = toRow(res.rows[0] as Row);
  await client.query(
    `INSERT INTO school_contract_idempotency (tenant_id, idempotency_key, contract_id, enrollment_id, plan_id, monthly_price_cents, installments, start_reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [params.tenantId, params.idempotencyKey, contract.id, params.enrollmentId, params.planId, params.monthlyPriceCents, params.installments, params.startReference],
  );
  await auditContract(client, params.tenantId, params.createdBy, 'create', contract.id);
  return { contract, idempotentReplay: false };
}

async function auditContract(client: PoolClient, tenantId: string, actorId: string, action: string, resourceId: string): Promise<void> {
  await client.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, actorId, action, 'school_contract', resourceId],
  );
}

export async function getSchoolContract(pool: Pool | PoolClient, tenantId: string, id: string): Promise<SchoolContractRow> {
  const res = await pool.query(`${SELECT} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!res.rowCount) throw new NotFoundError('contract');
  return toRow(res.rows[0] as Row);
}

export async function listSchoolContracts(pool: Pool, tenantId: string): Promise<SchoolContractRow[]> {
  const res = await pool.query(`${SELECT} WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
  return (res.rows as Row[]).map(toRow);
}

export async function activateSchoolContract(pool: Pool, tenantId: string, id: string, actorId: string): Promise<{ contract: SchoolContractRow; tuitions: Awaited<ReturnType<typeof generateTuition>>[] }> {
  return withTransaction(pool, async (c) => {
    const contract = await getSchoolContract(c, tenantId, id);
    if (contract.status !== 'DRAFT') throw new ContractRuleError('contract is not DRAFT');

    const enr = await c.query('SELECT student_id FROM enrollments WHERE id = $1 AND tenant_id = $2', [contract.enrollmentId, tenantId]);
    const studentId = (enr.rows[0] as { student_id: string }).student_id;

    const tuitions = [];
    for (let i = 0; i < contract.installments; i++) {
      tuitions.push(await generateTuition(c, {
        tenantId, planId: contract.planId, studentId,
        reference: nextReference(contract.startReference, i),
      }));
    }
    await c.query("UPDATE school_contracts SET status = 'ACTIVE' WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
    await auditContract(c, tenantId, actorId, 'activate', id);
    return { contract: { ...contract, status: 'ACTIVE' as const }, tuitions };
  });
}

export async function cancelSchoolContract(pool: Pool, tenantId: string, id: string, actorId: string): Promise<{ contract: SchoolContractRow; canceledTuitions: number }> {
  return withTransaction(pool, async (c) => {
    const contract = await getSchoolContract(c, tenantId, id);
    if (contract.status === 'CANCELED') throw new ContractRuleError('contract already canceled');

    const enr = await c.query('SELECT student_id FROM enrollments WHERE id = $1 AND tenant_id = $2', [contract.enrollmentId, tenantId]);
    const studentId = (enr.rows[0] as { student_id: string }).student_id;

    let canceled = 0;
    if (contract.status === 'ACTIVE') {
      const open = await c.query(
        "SELECT id, reference FROM tuitions WHERE tenant_id = $1 AND student_id = $2 AND status = 'OPEN'",
        [tenantId, studentId],
      );
      const refs = refsOf(contract);
      for (const t of open.rows as { id: string; reference: string }[]) {
        if (refs.includes(t.reference)) { await cancelTuition(c, tenantId, t.id); canceled++; }
      }
    }
    await c.query("UPDATE school_contracts SET status = 'CANCELED', canceled_at = now() WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
    await auditContract(c, tenantId, actorId, 'cancel', id);
    return { contract: { ...contract, status: 'CANCELED' as const }, canceledTuitions: canceled };
  });
}

function refsOf(contract: SchoolContractRow): string[] {
  return Array.from({ length: contract.installments }, (_, i) => nextReference(contract.startReference, i));
}
