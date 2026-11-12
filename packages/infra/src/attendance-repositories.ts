/**
 * E08-03 — chamada e presença auditável: lote com justificativa/atraso, revisão com trilha, report de frequência.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class AttendanceRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapAttendanceError(e: unknown): { status: number } {
  if (e instanceof AttendanceRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

const STATUSES = new Set(['PRESENT', 'ABSENT', 'LATE', 'JUSTIFIED']);

type Entry = { enrollmentId: string; status: string; minutesLate?: number; justification?: string };
type Attendance = {
  id: string; tenantId: string; sessionId: string; enrollmentId: string; status: string;
  minutesLate: number; justification: string | null; recordedBy: string | null; revisedBy: string | null;
};
type Row = Record<string, unknown> & {
  id: string; tenant_id: string; session_id: string; enrollment_id: string; status: string;
  minutes_late: number; justification: string | null; recorded_by: string | null; revised_by: string | null;
};
const toAtt = (r: Row): Attendance => ({
  id: r.id, tenantId: r.tenant_id, sessionId: r.session_id, enrollmentId: r.enrollment_id,
  status: r.status, minutesLate: r.minutes_late, justification: r.justification,
  recordedBy: r.recorded_by, revisedBy: r.revised_by,
});

function validateEntry(e: Entry): void {
  if (!STATUSES.has(e.status)) throw new AttendanceRuleError(`status inválido: ${e.status}`);
  if (e.status === 'JUSTIFIED' && !e.justification) throw new AttendanceRuleError('JUSTIFIED exige justificativa');
  if (e.status === 'LATE' && (!e.minutesLate || e.minutesLate < 1)) throw new AttendanceRuleError('LATE exige minutos de atraso >= 1');
}

/** R1-R2: lançamento em lote (upsert por aluno na sessão). */
export async function recordAttendance(c: PoolClient, tenantId: string, input: {
  sessionId: string; recordedBy: string; entries: Entry[];
}): Promise<Attendance[]> {
  for (const entry of input.entries) validateEntry(entry); // valida antes de tocar o banco
  const sess = await c.query('SELECT * FROM class_sessions WHERE id = $1 AND tenant_id = $2', [input.sessionId, tenantId]);
  if (!sess.rowCount) throw new NotFoundError('sessão não encontrada');
  const session = sess.rows[0] as { status: string; class_id: string };
  if (session.status === 'CANCELED') throw new AttendanceRuleError('sessão cancelada não aceita chamada');
  const out: Attendance[] = [];
  for (const entry of input.entries) {
    const enr = await c.query('SELECT * FROM enrollments WHERE id = $1 AND tenant_id = $2', [entry.enrollmentId, tenantId]);
    if (!enr.rowCount) throw new NotFoundError(`matrícula não encontrada: ${entry.enrollmentId}`);
    const existing = await c.query(
      'SELECT * FROM session_attendance WHERE tenant_id = $1 AND session_id = $2 AND enrollment_id = $3',
      [tenantId, input.sessionId, entry.enrollmentId],
    );
    const minutes = entry.status === 'LATE' ? entry.minutesLate! : 0;
    let row: Row;
    if (existing.rowCount) {
      const upd = await c.query(
        `UPDATE session_attendance SET status = $4, minutes_late = $5, justification = $6, recorded_by = $7, updated_at = now()
         WHERE tenant_id = $1 AND session_id = $2 AND enrollment_id = $3 RETURNING *`,
        [tenantId, input.sessionId, entry.enrollmentId, entry.status, minutes, entry.justification ?? null, input.recordedBy],
      );
      row = upd.rows[0] as Row;
    } else {
      const ins = await c.query(
        `INSERT INTO session_attendance (id, tenant_id, session_id, enrollment_id, status, minutes_late, justification, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [randomUUID(), tenantId, input.sessionId, entry.enrollmentId, entry.status, minutes, entry.justification ?? null, input.recordedBy],
      );
      row = ins.rows[0] as Row;
    }
    out.push(toAtt(row));
  }
  return out;
}

/** R3: revisão com trilha old→new e revised_by. */
export async function reviseAttendance(c: PoolClient, tenantId: string, attendanceId: string, input: {
  newStatus: string; reason: string; reviewerId: string; justification?: string;
}): Promise<Attendance> {
  if (!input.reason) throw new AttendanceRuleError('revisão exige motivo');
  const cur = await c.query('SELECT * FROM session_attendance WHERE tenant_id = $1 AND id = $2', [tenantId, attendanceId]);
  if (!cur.rowCount) throw new NotFoundError('registro de presença não encontrado');
  const old = cur.rows[0] as Row;
  if (input.newStatus === 'JUSTIFIED' && !old.justification && !input.justification) {
    throw new AttendanceRuleError('JUSTIFIED exige justificativa');
  }
  const minutes = input.newStatus === 'LATE' ? ((old.minutes_late as number) || 1) : 0;
  const justification = input.justification ?? (old.justification as string | null);
  const upd = await c.query(
    `UPDATE session_attendance SET status = $3, minutes_late = $4, justification = COALESCE($6, justification), revised_by = $5, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, attendanceId, input.newStatus, minutes, input.reviewerId, justification ?? null],
  );
  const row = upd.rows[0] as Row;
  await c.query(
    'INSERT INTO attendance_changes (id, tenant_id, attendance_id, old_status, new_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), tenantId, attendanceId, old.status as string, input.newStatus, input.reason, input.reviewerId],
  );
  return toAtt(row);
}

/** R4: percentual por aluno — presenças = PRESENT + LATE; LATE listado à parte. */
export async function attendanceReport(c: Pg, tenantId: string, classId: string, period: { from: string; to: string }): Promise<Array<{
  enrollmentId: string; studentName: string; total: number; presentCount: number; lateCount: number; justified: number; absent: number; percent: number;
}>> {
  const r = await c.query(
    `SELECT sa.enrollment_id, p.name AS student_name, sa.status
     FROM session_attendance sa
     JOIN class_sessions cs ON cs.id = sa.session_id AND cs.tenant_id = sa.tenant_id
     LEFT JOIN enrollments e ON e.id::text = sa.enrollment_id AND e.tenant_id = sa.tenant_id
     LEFT JOIN people p ON p.id::text = e.student_id AND p.tenant_id = sa.tenant_id
     WHERE sa.tenant_id = $1 AND cs.class_id = $2 AND cs.date >= $3 AND cs.date <= $4`,
    [tenantId, classId, period.from, period.to],
  );
  const byStudent = new Map<string, { enrollmentId: string; studentName: string; total: number; presentCount: number; lateCount: number; justified: number; absent: number }>();
  for (const row of r.rows as Array<{ enrollment_id: string; student_name: string | null; status: string }>) {
    const key = row.enrollment_id;
    const agg = byStudent.get(key) ?? {
      enrollmentId: key, studentName: row.student_name ?? key, total: 0, presentCount: 0, lateCount: 0, justified: 0, absent: 0,
    };
    agg.total += 1;
    if (row.status === 'PRESENT') agg.presentCount += 1;
    else if (row.status === 'LATE') { agg.presentCount += 1; agg.lateCount += 1; }
    else if (row.status === 'JUSTIFIED') agg.justified += 1;
    else agg.absent += 1;
    byStudent.set(key, agg);
  }
  return [...byStudent.values()].map((a) => ({
    ...a,
    percent: Math.round((a.presentCount / a.total) * 100),
  }));
}

export async function getSessionAttendance(c: Pg, tenantId: string, sessionId: string): Promise<Attendance[]> {
  const r = await c.query('SELECT * FROM session_attendance WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at', [tenantId, sessionId]);
  return (r.rows as Row[]).map(toAtt);
}

export async function attendanceChanges(c: Pg, tenantId: string, attendanceId: string): Promise<Array<{
  oldStatus: string; newStatus: string; reason: string; changedBy: string | null; createdAt: Date;
}>> {
  const r = await c.query(
    'SELECT old_status, new_status, reason, changed_by, created_at FROM attendance_changes WHERE tenant_id = $1 AND attendance_id = $2 ORDER BY created_at DESC',
    [tenantId, attendanceId],
  );
  return (r.rows as Array<{ old_status: string; new_status: string; reason: string; changed_by: string | null; created_at: Date }>).map((x) => ({
    oldStatus: x.old_status, newStatus: x.new_status, reason: x.reason, changedBy: x.changed_by, createdAt: x.created_at,
  }));
}
