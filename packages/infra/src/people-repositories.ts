/**
 * E05-A — Repositórios de pessoas/unidades/responsáveis. Toda query ESCOPADA por tenant.
 * Regras de domínio vivem aqui (não no HTTP) para reuso e cobertura 100×4.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface UnitRow {
  id: string;
  tenantId: string;
  name: string;
  parentId: string | null;
}

export interface PersonRow {
  id: string;
  tenantId: string;
  unitId: string;
  kind: 'STUDENT' | 'GUARDIAN' | 'STAFF';
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export const MAX_UNIT_DEPTH = 20;

export class UnitCycleError extends Error {
  override name = 'UnitCycleError';
  constructor() {
    super('unit parent would create a cycle');
  }
}
export class NotFoundError extends Error {
  override name = 'NotFoundError';
  constructor(what: string) {
    super(`${what} not found`);
  }
}
export class GuardianRuleError extends Error {
  override name = 'GuardianRuleError';
  constructor(msg: string) {
    super(msg);
  }
}
export class ConflictError extends Error {
  override name = 'ConflictError';
  constructor(msg: string) {
    super(msg);
  }
}

export async function insertUnit(client: Pool | PoolClient, params: { tenantId: string; name: string; parentId?: string | null }): Promise<UnitRow> {
  if (params.parentId !== undefined && params.parentId !== null) {
    // unidade pai deve existir NO MESMO tenant; e não pode criar ciclo
    const parent = await client.query('SELECT id, tenant_id, parent_id FROM units WHERE id = $1', [params.parentId]);
    if (!parent.rowCount) throw new NotFoundError('parent unit');
    const p = parent.rows[0] as { id: string; tenant_id: string; parent_id: string | null };
    if (p.tenant_id !== params.tenantId) throw new NotFoundError('parent unit');
    await assertNoCycle(client, params.tenantId, params.parentId, null);
  }
  const res = await client.query(
    'INSERT INTO units (id, tenant_id, name, parent_id) VALUES ($1,$2,$3,$4) RETURNING id, tenant_id, name, parent_id',
    [randomUUID(), params.tenantId, params.name, params.parentId ?? null],
  );
  const r = res.rows[0] as { id: string; tenant_id: string; name: string; parent_id: string | null };
  return { id: r.id, tenantId: r.tenant_id, name: r.name, parentId: r.parent_id };
}

/** Sobe a cadeia de pais (limite MAX_UNIT_DEPTH - 1 hops; mais que isso = cadeia funda demais/ciclo). */
export async function assertNoCycle(client: Pool | PoolClient, tenantId: string, startId: string, excludeId: string | null): Promise<void> {
  let current: string | null = startId;
  for (let depth = 0; depth < MAX_UNIT_DEPTH - 1 && current !== null; depth++) {
    if (excludeId !== null && current === excludeId) throw new UnitCycleError();
    const res: { rows: { parent_id: string | null }[]; rowCount: number | null } = await client.query('SELECT parent_id FROM units WHERE id = $1 AND tenant_id = $2', [current, tenantId]);
    const row = res.rows[0];
    if (!res.rowCount || row === undefined) throw new NotFoundError('unit in parent chain');
    current = row.parent_id;
  }
  if (current !== null) throw new UnitCycleError();
}

export async function listUnits(pool: Pool, tenantId: string): Promise<UnitRow[]> {
  const res = await pool.query(
    'SELECT id, tenant_id, name, parent_id FROM units WHERE tenant_id = $1 ORDER BY created_at, name',
    [tenantId],
  );
  return (res.rows as { id: string; tenant_id: string; name: string; parent_id: string | null }[]).map((r) => ({
    id: r.id, tenantId: r.tenant_id, name: r.name, parentId: r.parent_id,
  }));
}

export async function insertPerson(client: Pool | PoolClient, params: {
  tenantId: string; unitId: string; kind: PersonRow['kind']; name: string;
  document?: string | null; email?: string | null; phone?: string | null;
}): Promise<PersonRow> {
  const unit = await client.query('SELECT id, tenant_id FROM units WHERE id = $1', [params.unitId]);
  if (!unit.rowCount) throw new NotFoundError('unit');
  if ((unit.rows[0] as { tenant_id: string }).tenant_id !== params.tenantId) throw new NotFoundError('unit');
  const res = await client.query(
    `INSERT INTO people (id, tenant_id, unit_id, kind, name, document, email, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, tenant_id, unit_id, kind, name, document, email, phone, active`,
    [randomUUID(), params.tenantId, params.unitId, params.kind, params.name, params.document ?? null, params.email ?? null, params.phone ?? null],
  );
  return toPerson(res.rows[0] as Record<string, unknown>);
}

function toPerson(r: Record<string, unknown>): PersonRow {
  return {
    id: r.id as string, tenantId: r.tenant_id as string, unitId: r.unit_id as string,
    kind: r.kind as PersonRow['kind'], name: r.name as string,
    document: (r.document as string | null) ?? null, email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null, active: r.active as boolean,
  };
}

export async function listPeople(pool: Pool, tenantId: string, filter: { kind?: PersonRow['kind']; unitId?: string; nameQuery?: string }): Promise<PersonRow[]> {
  const clauses: string[] = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.kind) {
    values.push(filter.kind);
    clauses.push(`kind = $${values.length}`);
  }
  if (filter.unitId) {
    values.push(filter.unitId);
    clauses.push(`unit_id = $${values.length}`);
  }
  if (filter.nameQuery) {
    const escaped = `%${filter.nameQuery.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    values.push(escaped);
    clauses.push(`name ILIKE $${values.length} ESCAPE '\\'`);
  }
  const res = await pool.query(
    `SELECT id, tenant_id, unit_id, kind, name, document, email, phone, active FROM people WHERE ${clauses.join(' AND ')} ORDER BY name`,
    values,
  );
  return (res.rows as Record<string, unknown>[]).map(toPerson);
}

export async function getPerson(pool: Pool, tenantId: string, id: string): Promise<PersonRow> {
  const res = await pool.query(
    'SELECT id, tenant_id, unit_id, kind, name, document, email, phone, active FROM people WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (!res.rowCount) throw new NotFoundError('person');
  return toPerson(res.rows[0] as Record<string, unknown>);
}

export async function updatePerson(client: Pool | PoolClient, tenantId: string, id: string, patch: {
  name?: string; unitId?: string; document?: string | null; email?: string | null; phone?: string | null; active?: boolean;
}): Promise<PersonRow> {
  const existing = await getPerson(client as Pool, tenantId, id);
  if (patch.unitId !== undefined && patch.unitId !== existing.unitId) {
    const unit = await client.query('SELECT id, tenant_id FROM units WHERE id = $1', [patch.unitId]);
    if (!unit.rowCount) throw new NotFoundError('unit');
    if ((unit.rows[0] as { tenant_id: string }).tenant_id !== tenantId) throw new NotFoundError('unit');
  }
  const res = await client.query(
    `UPDATE people SET
       name = $3, unit_id = $4, document = $5, email = $6, phone = $7, active = $8
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, unit_id, kind, name, document, email, phone, active`,
    [
      id, tenantId,
      patch.name ?? existing.name, patch.unitId ?? existing.unitId,
      patch.document ?? existing.document,
      patch.email ?? existing.email,
      patch.phone ?? existing.phone,
      patch.active ?? existing.active,
    ],
  );
  return toPerson(res.rows[0] as Record<string, unknown>);
}

export async function linkGuardian(client: Pool | PoolClient, params: {
  tenantId: string; studentId: string; guardianId: string; relation: string; isPrimary?: boolean;
}): Promise<void> {
  const guardian = await getPerson(client as Pool, params.tenantId, params.guardianId);
  const student = await getPerson(client as Pool, params.tenantId, params.studentId);
  if (!guardian.active || !student.active) throw new GuardianRuleError('inactive person cannot receive new guardianship');
  if (guardian.kind !== 'GUARDIAN') throw new GuardianRuleError('guardian must have kind GUARDIAN');
  if (student.kind !== 'STUDENT') throw new GuardianRuleError('student must have kind STUDENT');
  const dup = await client.query(
    'SELECT id FROM guardianships WHERE guardian_id = $1 AND student_id = $2',
    [params.guardianId, params.studentId],
  );
  if (dup.rowCount) throw new ConflictError('guardianship already exists');
  await client.query(
    'INSERT INTO guardianships (id, tenant_id, guardian_id, student_id, relation, is_primary) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (guardian_id, student_id) DO NOTHING',
    [randomUUID(), params.tenantId, params.guardianId, params.studentId, params.relation, params.isPrimary ?? false],
  );
}

export async function listGuardians(pool: Pool, tenantId: string, studentId: string): Promise<PersonRow[]> {
  const student = await getPerson(pool, tenantId, studentId);
  if (student.kind !== 'STUDENT') throw new GuardianRuleError('student must have kind STUDENT');
  const res = await pool.query(
    `SELECT p.id, p.tenant_id, p.unit_id, p.kind, p.name, p.document, p.email, p.phone, p.active
     FROM guardianships g JOIN people p ON p.id = g.guardian_id
     WHERE g.student_id = $1 AND g.tenant_id = $2 ORDER BY g.is_primary DESC, p.name`,
    [studentId, tenantId],
  );
  return (res.rows as Record<string, unknown>[]).map(toPerson);
}
