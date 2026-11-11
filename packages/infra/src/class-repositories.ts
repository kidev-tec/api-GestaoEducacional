/**
 * E08-01 — classes/courses/offers/teachers.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class ClassRuleError extends Error {}
export class ConflictError extends Error { override name = 'ConflictError'; }
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapClassError(e: unknown): { status: number } {
  if (e instanceof ClassRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  if (e instanceof ConflictError) return { status: 409 };
  return { status: 500 };
}

export type Course = { id: string; tenantId: string; name: string; active: boolean };
type CourseRow = Record<string, unknown> & { id: string; tenant_id: string; name: string; active: boolean };
const toCourse = (r: CourseRow): Course => ({ id: r.id, tenantId: r.tenant_id, name: r.name, active: r.active });

export async function createCourse(c: Pg, tenantId: string, input: { name: string }): Promise<Course> {
  if (!input.name?.trim()) throw new ClassRuleError('name required');
  const r = await c.query(
    'INSERT INTO courses (id, tenant_id, name) VALUES ($1,$2,$3) RETURNING id, tenant_id, name, active',
    [randomUUID(), tenantId, input.name],
  );
  return toCourse(r.rows[0] as CourseRow);
}

export async function listCourses(c: Pg, tenantId: string): Promise<Course[]> {
  const r = await c.query('SELECT id, tenant_id, name, active FROM courses WHERE tenant_id = $1 ORDER BY created_at', [tenantId]);
  return (r.rows as CourseRow[]).map(toCourse);
}

export async function archiveCourse(c: PoolClient, tenantId: string, courseId: string): Promise<Course> {
  const cur = await c.query('SELECT id FROM courses WHERE id = $1 AND tenant_id = $2', [courseId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('curso não encontrado');
  const active = await c.query(
    "SELECT COUNT(*)::int AS n FROM classes WHERE tenant_id = $1 AND course_id = $2 AND status IN ('PLANNED','OPEN','RUNNING')",
    [tenantId, courseId],
  );
  if (Number((active.rows[0] as { n: number }).n) > 0) throw new ConflictError('curso possui turmas ativas');
  const r = await c.query(
    'UPDATE courses SET active = false, archived_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, name, active',
    [courseId, tenantId],
  );
  return toCourse(r.rows[0] as CourseRow);
}

export type ClassEntity = {
  id: string; tenantId: string; courseId: string; unitId: string; name: string;
  capacity: number; status: 'PLANNED' | 'OPEN' | 'RUNNING' | 'CLOSED';
};
type ClassRow = Record<string, unknown> & {
  id: string; tenant_id: string; course_id: string; unit_id: string; name: string;
  capacity: number; status: ClassEntity['status'];
};
const toClass = (r: ClassRow): ClassEntity => ({
  id: r.id, tenantId: r.tenant_id, courseId: r.course_id, unitId: r.unit_id, name: r.name, capacity: r.capacity, status: r.status,
});

async function activeEnrolled(c: PoolClient, tenantId: string, classId: string): Promise<number> {
  const r = await c.query(
    "SELECT COUNT(*)::int AS n FROM enrollments WHERE tenant_id = $1 AND offer_id IN (SELECT id::text FROM offers WHERE tenant_id = $1 AND class_id::text = $2::text) AND state IN ('DRAFT','PENDING_DOCUMENTS','PENDING_APPROVAL','ACTIVE')",
    [tenantId, classId],
  );
  return Number((r.rows[0] as { n: number }).n);
}

export async function createClass(c: Pg, tenantId: string, input: {
  courseId: string; unitId: string; name: string; capacity: number;
}): Promise<ClassEntity> {
  if (!Number.isInteger(input.capacity) || input.capacity <= 0) throw new ClassRuleError('capacity deve ser inteiro > 0');
  const r = await c.query(
    `INSERT INTO classes (id, tenant_id, course_id, unit_id, name, capacity) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, tenant_id, course_id, unit_id, name, capacity, status`,
    [randomUUID(), tenantId, input.courseId, input.unitId, input.name, input.capacity],
  );
  return toClass(r.rows[0] as ClassRow);
}

export async function updateClass(c: PoolClient, tenantId: string, classId: string, patch: {
  name?: string; capacity?: number;
}): Promise<ClassEntity> {
  const cur = await c.query('SELECT * FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('turma não encontrada');
  if (patch.capacity != null) {
    if (!Number.isInteger(patch.capacity) || patch.capacity <= 0) throw new ClassRuleError('capacity deve ser inteiro > 0');
    const enrolled = await activeEnrolled(c, tenantId, classId);
    if (patch.capacity < enrolled) throw new ClassRuleError(`capacity ${patch.capacity} < matrículas ativas ${enrolled}`);
  }
  const r = await c.query(
    `UPDATE classes SET
       name = COALESCE($3, name),
       capacity = COALESCE($4, capacity),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, course_id, unit_id, name, capacity, status`,
    [classId, tenantId, patch.name ?? null, patch.capacity ?? null],
  );
  return toClass(r.rows[0] as ClassRow);
}

const TRANSITIONS: Record<ClassEntity['status'], ClassEntity['status'][]> = {
  PLANNED: ['OPEN'],
  OPEN: ['RUNNING'],
  RUNNING: ['CLOSED'],
  CLOSED: [],
};

export async function transitionClass(c: PoolClient, tenantId: string, classId: string, to: ClassEntity['status']): Promise<ClassEntity> {
  const cur = await c.query('SELECT * FROM classes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [classId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('turma não encontrada');
  const from = toClass(cur.rows[0] as ClassRow).status;
  if (!TRANSITIONS[from].includes(to)) throw new ClassRuleError(`transição ${from}→${to} inválida`);
  const r = await c.query(
    `UPDATE classes SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, course_id, unit_id, name, capacity, status`,
    [classId, tenantId, to],
  );
  return toClass(r.rows[0] as ClassRow);
}

export async function listClasses(c: Pg, tenantId: string, filter: { courseId?: string; status?: string }): Promise<ClassEntity[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.courseId) { vals.push(filter.courseId); conds.push(`course_id = $${vals.length}`); }
  if (filter.status) { vals.push(filter.status); conds.push(`status = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, course_id, unit_id, name, capacity, status FROM classes WHERE ${conds.join(' AND ')} ORDER BY created_at`,
    vals,
  );
  return (r.rows as ClassRow[]).map(toClass);
}

export async function classOccupancy(c: Pg, tenantId: string, classId: string): Promise<{ capacity: number; enrolled: number; available: number }> {
  const k = await c.query('SELECT capacity FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenantId]);
  if (!k.rowCount) throw new NotFoundError('turma não encontrada');
  const capacity = (k.rows[0] as { capacity: number }).capacity;
  const r = await c.query(
    `SELECT COUNT(*)::int AS n FROM enrollments e JOIN offers o ON o.id::text = e.offer_id AND o.tenant_id = e.tenant_id
     WHERE e.tenant_id = $1 AND o.class_id = $2 AND e.state IN ('DRAFT','PENDING_DOCUMENTS','PENDING_APPROVAL','ACTIVE')`,
    [tenantId, classId],
  );
  const enrolled = Number((r.rows[0] as { n: number }).n);
  return { capacity, enrolled, available: capacity - enrolled };
}

export async function addTeacher(c: Pg, tenantId: string, classId: string, userId: string): Promise<{ classId: string; userId: string }> {
  const u = await c.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (!u.rowCount) throw new NotFoundError('usuário não encontrado');
  const k = await c.query('SELECT id FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenantId]);
  if (!k.rowCount) throw new NotFoundError('turma não encontrada');
  await c.query(
    'INSERT INTO class_teachers (tenant_id, class_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [tenantId, classId, userId],
  );
  return { classId, userId };
}

export async function removeTeacher(c: Pg, tenantId: string, classId: string, userId: string): Promise<{ removed: boolean }> {
  await c.query('DELETE FROM class_teachers WHERE tenant_id = $1 AND class_id = $2 AND user_id = $3', [tenantId, classId, userId]);
  return { removed: true };
}

export type Offer = { id: string; tenantId: string; classId: string; name: string; priceCents: number; active: boolean };
type OfferRow = Record<string, unknown> & { id: string; tenant_id: string; class_id: string; name: string; price_cents: number; active: boolean };
const toOffer = (r: OfferRow): Offer => ({ id: r.id, tenantId: r.tenant_id, classId: r.class_id, name: r.name, priceCents: r.price_cents, active: r.active });

export async function createOffer(c: Pg, tenantId: string, input: { classId: string; name: string; priceCents: number }): Promise<Offer> {
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new ClassRuleError('priceCents deve ser inteiro >= 0');
  const k = await c.query('SELECT id FROM classes WHERE id = $1 AND tenant_id = $2', [input.classId, tenantId]);
  if (!k.rowCount) throw new NotFoundError('turma não encontrada');
  const r = await c.query(
    'INSERT INTO offers (id, tenant_id, class_id, name, price_cents) VALUES ($1,$2,$3,$4,$5) RETURNING id, tenant_id, class_id, name, price_cents, active',
    [randomUUID(), tenantId, input.classId, input.name, input.priceCents],
  );
  return toOffer(r.rows[0] as OfferRow);
}

export async function listOffers(c: Pg, tenantId: string, classId: string): Promise<Offer[]> {
  const r = await c.query(
    'SELECT id, tenant_id, class_id, name, price_cents, active FROM offers WHERE tenant_id = $1 AND class_id = $2 ORDER BY created_at',
    [tenantId, classId],
  );
  return (r.rows as OfferRow[]).map(toOffer);
}

export async function updateOffer(c: Pg, tenantId: string, offerId: string, patch: { name?: string; priceCents?: number; active?: boolean }): Promise<Offer> {
  if (patch.priceCents != null && (!Number.isInteger(patch.priceCents) || patch.priceCents < 0)) throw new ClassRuleError('priceCents deve ser inteiro >= 0');
  const cur = await c.query('SELECT id FROM offers WHERE id = $1 AND tenant_id = $2', [offerId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('oferta não encontrada');
  const r = await c.query(
    `UPDATE offers SET name = COALESCE($3, name), price_cents = COALESCE($4, price_cents), active = COALESCE($5, active)
     WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, class_id, name, price_cents, active`,
    [offerId, tenantId, patch.name ?? null, patch.priceCents ?? null, patch.active ?? null],
  );
  return toOffer(r.rows[0] as OfferRow);
}
