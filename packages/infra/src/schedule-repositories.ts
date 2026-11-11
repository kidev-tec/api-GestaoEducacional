/**
 * E08-02 — grade, horários, salas, feriados, sessões, conflitos.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class ScheduleRuleError extends Error {}
export class ConflictError extends Error { override name = 'ConflictError'; }
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapScheduleError(e: unknown): { status: number } {
  if (e instanceof ScheduleRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  if (e instanceof ConflictError) return { status: 409 };
  return { status: 500 };
}

const assertRange = (startMinute: number, endMinute: number): void => {
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1440) throw new ScheduleRuleError('start_minute inválido');
  if (!Number.isInteger(endMinute) || endMinute < 0 || endMinute > 1440) throw new ScheduleRuleError('end_minute inválido');
  if (endMinute <= startMinute) throw new ScheduleRuleError('end_minute deve ser maior que start_minute');
};

// ─── salas ───
export type Room = { id: string; tenantId: string; unitId: string; name: string; capacity: number };
type RoomRow = Record<string, unknown> & { id: string; tenant_id: string; unit_id: string; name: string; capacity: number };
const toRoom = (r: RoomRow): Room => ({ id: r.id, tenantId: r.tenant_id, unitId: r.unit_id, name: r.name, capacity: r.capacity });

export async function createRoom(c: Pg, tenantId: string, input: { unitId: string; name: string; capacity: number }): Promise<Room> {
  if (!Number.isInteger(input.capacity) || input.capacity <= 0) throw new ScheduleRuleError('capacity deve ser inteiro > 0');
  const u = await c.query('SELECT id FROM units WHERE id = $1 AND tenant_id = $2', [input.unitId, tenantId]);
  if (!u.rowCount) throw new NotFoundError('unidade não encontrada');
  const r = await c.query(
    'INSERT INTO rooms (id, tenant_id, unit_id, name, capacity) VALUES ($1,$2,$3,$4,$5) RETURNING id, tenant_id, unit_id, name, capacity',
    [randomUUID(), tenantId, input.unitId, input.name, input.capacity],
  );
  return toRoom(r.rows[0] as RoomRow);
}

export async function listRooms(c: Pg, tenantId: string): Promise<Room[]> {
  const r = await c.query('SELECT id, tenant_id, unit_id, name, capacity FROM rooms WHERE tenant_id = $1 ORDER BY created_at', [tenantId]);
  return (r.rows as RoomRow[]).map(toRoom);
}

export async function updateRoom(c: Pg, tenantId: string, roomId: string, patch: { name?: string; capacity?: number }): Promise<Room> {
  if (patch.capacity != null && (!Number.isInteger(patch.capacity) || patch.capacity <= 0)) throw new ScheduleRuleError('capacity deve ser inteiro > 0');
  const cur = await c.query('SELECT id FROM rooms WHERE id = $1 AND tenant_id = $2', [roomId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('sala não encontrada');
  const r = await c.query(
    'UPDATE rooms SET name = COALESCE($3, name), capacity = COALESCE($4, capacity) WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, unit_id, name, capacity',
    [roomId, tenantId, patch.name ?? null, patch.capacity ?? null],
  );
  return toRoom(r.rows[0] as RoomRow);
}

// ─── feriados ───
export type Holiday = { id: string; tenantId: string; date: string; name: string };
type HolidayRow = Record<string, unknown> & { id: string; tenant_id: string; date: string; name: string };
const toHoliday = (r: HolidayRow): Holiday => ({ id: r.id, tenantId: r.tenant_id, date: String(r.date), name: r.name });

/** R7: feriado cancela sessões agendadas do dia (transacional). */
export async function addHoliday(c: PoolClient, tenantId: string, input: { date: string; name: string }): Promise<Holiday> {
  const r = await c.query(
    `INSERT INTO holidays (id, tenant_id, date, name) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, date) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, tenant_id, date, name`,
    [randomUUID(), tenantId, input.date, input.name],
  );
  // cancela sessões do dia
  const sessions = await c.query(
    `SELECT id FROM class_sessions WHERE tenant_id = $1 AND date = $2 AND status IN ('SCHEDULED','RESCHEDULED') FOR UPDATE`,
    [tenantId, input.date],
  );
  for (const s of sessions.rows as Array<{ id: string }>) {
    await c.query(
      "UPDATE class_sessions SET status = 'CANCELED', updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [s.id, tenantId],
    );
    await c.query(
      "INSERT INTO session_changes (id, tenant_id, session_id, change_type, reason) VALUES ($1,$2,$3,'CANCEL','holiday')",
      [randomUUID(), tenantId, s.id],
    );
  }
  return toHoliday(r.rows[0] as HolidayRow);
}

export async function listHolidays(c: Pg, tenantId: string): Promise<Holiday[]> {
  const r = await c.query('SELECT id, tenant_id, date, name FROM holidays WHERE tenant_id = $1 ORDER BY date', [tenantId]);
  return (r.rows as HolidayRow[]).map(toHoliday);
}

export async function removeHoliday(c: Pg, tenantId: string, holidayId: string): Promise<{ removed: boolean }> {
  const cur = await c.query('SELECT id FROM holidays WHERE id = $1 AND tenant_id = $2', [holidayId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('feriado não encontrado');
  await c.query('DELETE FROM holidays WHERE id = $1 AND tenant_id = $2', [holidayId, tenantId]);
  return { removed: true };
}

// ─── grade recorrente ───
export type Schedule = { id: string; tenantId: string; classId: string; roomId: string | null; weekday: number; startMinute: number; endMinute: number };
type SchedRow = Record<string, unknown> & { id: string; tenant_id: string; class_id: string; room_id: string | null; weekday: number; start_minute: number; end_minute: number };
const toSched = (r: SchedRow): Schedule => ({ id: r.id, tenantId: r.tenant_id, classId: r.class_id, roomId: r.room_id, weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute });

export async function addSchedule(c: Pg, tenantId: string, input: {
  classId: string; roomId?: string | null; weekday: number; startMinute: number; endMinute: number;
}): Promise<Schedule> {
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new ScheduleRuleError('weekday deve ser 0-6');
  assertRange(input.startMinute, input.endMinute);
  const k = await c.query('SELECT id, capacity FROM classes WHERE id = $1 AND tenant_id = $2', [input.classId, tenantId]);
  if (!k.rowCount) throw new NotFoundError('turma não encontrada');
  const classCapacity = (k.rows[0] as { capacity: number }).capacity;
  if (input.roomId != null) {
    const room = await c.query('SELECT capacity FROM rooms WHERE id = $1 AND tenant_id = $2', [input.roomId, tenantId]);
    if (!room.rowCount) throw new NotFoundError('sala não encontrada');
    if (Number((room.rows[0] as { capacity: number }).capacity) < classCapacity) {
      throw new ScheduleRuleError('capacidade da sala menor que a da turma');
    }
  }
  const r = await c.query(
    `INSERT INTO class_schedules (id, tenant_id, class_id, room_id, weekday, start_minute, end_minute)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tenant_id, class_id, room_id, weekday, start_minute, end_minute`,
    [randomUUID(), tenantId, input.classId, input.roomId ?? null, input.weekday, input.startMinute, input.endMinute],
  );
  return toSched(r.rows[0] as SchedRow);
}

export async function listSchedules(c: Pg, tenantId: string, classId: string): Promise<Schedule[]> {
  const r = await c.query(
    'SELECT id, tenant_id, class_id, room_id, weekday, start_minute, end_minute FROM class_schedules WHERE tenant_id = $1 AND class_id = $2 ORDER BY weekday, start_minute',
    [tenantId, classId],
  );
  return (r.rows as SchedRow[]).map(toSched);
}

export async function removeSchedule(c: Pg, tenantId: string, classId: string, scheduleId: string): Promise<{ removed: boolean }> {
  const cur = await c.query('SELECT id FROM class_schedules WHERE id = $1 AND tenant_id = $2 AND class_id = $3', [scheduleId, tenantId, classId]);
  if (!cur.rowCount) throw new NotFoundError('grade não encontrada');
  await c.query('DELETE FROM class_schedules WHERE id = $1 AND tenant_id = $2', [scheduleId, tenantId]);
  return { removed: true };
}

// ─── sessões ───
export type Session = {
  id: string; tenantId: string; classId: string; scheduleId: string | null; roomId: string | null;
  date: string; startMinute: number; endMinute: number; status: 'SCHEDULED' | 'RESCHEDULED' | 'CANCELED';
};
type SessRow = Record<string, unknown> & {
  id: string; tenant_id: string; class_id: string; schedule_id: string | null; room_id: string | null;
  date: string | Date; start_minute: number; end_minute: number; status: Session['status'];
};
const toSession = (r: SessRow): Session => ({
  id: r.id, tenantId: r.tenant_id, classId: r.class_id, scheduleId: r.schedule_id, roomId: r.room_id,
  date: String(r.date), startMinute: r.start_minute, endMinute: r.end_minute, status: r.status,
});

/** weekday de uma data YYYY-MM-DD (0=dom) sem libs externas. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const MAX_RANGE_DAYS = 90;

/** R4: expande recorrências em sessões; pula feriados e datas já existentes (idempotente). */
export async function expandSessions(c: PoolClient, tenantId: string, classId: string, from: string, to: string): Promise<{ created: number }> {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) throw new ScheduleRuleError('range de datas inválido');
  if (days > MAX_RANGE_DAYS) throw new ScheduleRuleError(`range máximo de ${MAX_RANGE_DAYS} dias`);
  const scheds = await c.query(
    'SELECT * FROM class_schedules WHERE tenant_id = $1 AND class_id = $2',
    [tenantId, classId],
  );
  const classInfo = await c.query('SELECT capacity FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenantId]);
  if (!classInfo.rowCount) throw new NotFoundError('turma não encontrada');
  const classCapacity = (classInfo.rows[0] as { capacity: number }).capacity;
  const holidayRows = await c.query('SELECT date FROM holidays WHERE tenant_id = $1 AND date BETWEEN $2 AND $3', [tenantId, from, to]);
  const holidaySet = new Set((holidayRows.rows as Array<{ date: string }>).map((h) => String(h.date)));
  const existing = await c.query(
    'SELECT date, start_minute FROM class_sessions WHERE tenant_id = $1 AND class_id = $2 AND date BETWEEN $3 AND $4',
    [tenantId, classId, from, to],
  );
  const existingSet = new Set((existing.rows as Array<{ date: string | Date; start_minute: number }>).map((e) => `${e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date)}:${e.start_minute}`));
  let created = 0;
  for (const schedRaw of scheds.rows as SchedRow[]) {
    const sched = toSched(schedRaw);
    if (sched.roomId != null) {
      const room = await c.query('SELECT capacity FROM rooms WHERE id = $1 AND tenant_id = $2', [sched.roomId, tenantId]);
      if (room.rowCount && Number((room.rows[0] as { capacity: number }).capacity) < classCapacity) {
        throw new ScheduleRuleError('capacidade da sala menor que a da turma');
      }
    }
    for (let i = 0; i <= days; i++) {
      const date = addDays(from, i);
      if (weekdayOf(date) !== sched.weekday) continue;
      if (holidaySet.has(date)) continue; // R7: feriado pula
      if (existingSet.has(`${date}:${sched.startMinute}`)) continue; // idempotente
      const ins = await c.query(
        `INSERT INTO class_sessions (id, tenant_id, class_id, schedule_id, room_id, date, start_minute, end_minute)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, tenant_id, class_id, schedule_id, room_id, date, start_minute, end_minute, status`,
        [randomUUID(), tenantId, classId, sched.id, sched.roomId, date, sched.startMinute, sched.endMinute],
      );
      const sess = ins.rows[0] as SessRow & { id: string };
      await c.query(
        "INSERT INTO session_changes (id, tenant_id, session_id, change_type, reason) VALUES ($1,$2,$3,'CREATE','expansão de grade')",
        [randomUUID(), tenantId, sess.id],
      );
      created += 1;
    }
  }
  return { created };
}

/** Detecta conflito de sala (mesma sala, faixa sobreposta, sessão não cancelada) ou de turma. */
async function detectConflict(c: PoolClient, tenantId: string, input: {
  roomId: string | null; classId: string; date: string; startMinute: number; endMinute: number; excludeSessionId?: string;
}): Promise<void> {
  const conds = [
    'tenant_id = $1', 'date = $2', "status <> 'CANCELED'",
    'start_minute < $4', 'end_minute > $3', // overlap: a.start < b.end AND b.start < a.start
  ];
  const vals: unknown[] = [tenantId, input.date, input.startMinute, input.endMinute];
  if (input.excludeSessionId) { vals.push(input.excludeSessionId); conds.push(`id <> $${vals.length}`); }
  if (input.roomId != null) { vals.push(input.roomId); conds.push(`room_id = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, room_id, class_id /* overlap */ FROM class_sessions WHERE ${conds.join(' AND ')} LIMIT 1`,
    vals,
  );
  if (!r.rowCount) return;
  const hit = r.rows[0] as { room_id: string | null; class_id: string };
  if (hit.room_id != null && input.roomId != null && hit.room_id === input.roomId) throw new ConflictError('conflito: sala ocupada');
  if (hit.class_id === input.classId) throw new ConflictError('conflito: turma já possui sessão sobreposta');
  throw new ConflictError('conflito de agendamento');
}

/** R5: remarca sessão (data/minutos), grava trilha com reason >= 4. */
export async function rescheduleSession(c: PoolClient, tenantId: string, sessionId: string, patch: {
  date: string; startMinute: number; endMinute: number; roomId?: string | null;
}, reason: string): Promise<Session> {
  if (reason == null || reason.trim().length < 4) throw new ScheduleRuleError('reason deve ter ao menos 4 caracteres');
  assertRange(patch.startMinute, patch.endMinute);
  const cur = await c.query('SELECT * FROM class_sessions WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [sessionId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('sessão não encontrada');
  const sess = toSession(cur.rows[0] as SessRow);
  if (sess.status === 'CANCELED') throw new ScheduleRuleError('sessão cancelada não pode ser remarcada');
  await detectConflict(c, tenantId, {
    roomId: patch.roomId ?? sess.roomId, classId: sess.classId,
    date: patch.date, startMinute: patch.startMinute, endMinute: patch.endMinute,
    excludeSessionId: sessionId,
  });
  const r = await c.query(
    `UPDATE class_sessions SET date = $3, start_minute = $4, end_minute = $5,
       room_id = COALESCE($6, room_id), status = 'RESCHEDULED', updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, class_id, schedule_id, room_id, date, start_minute, end_minute, status`,
    [sessionId, tenantId, patch.date, patch.startMinute, patch.endMinute, patch.roomId ?? null],
  );
  await c.query(
    "INSERT INTO session_changes (id, tenant_id, session_id, change_type, reason) VALUES ($1,$2,$3,'RESCHEDULE',$4)",
    [randomUUID(), tenantId, sessionId, reason],
  );
  return toSession(r.rows[0] as SessRow);
}

/** R6: cancela sessão com reason >= 4. */
export async function cancelSession(c: PoolClient, tenantId: string, sessionId: string, reason: string): Promise<Session> {
  if (reason == null || reason.trim().length < 4) throw new ScheduleRuleError('reason deve ter ao menos 4 caracteres');
  const cur = await c.query('SELECT * FROM class_sessions WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [sessionId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('sessão não encontrada');
  if ((toSession(cur.rows[0] as SessRow)).status === 'CANCELED') throw new ScheduleRuleError('sessão já cancelada');
  const r = await c.query(
    `UPDATE class_sessions SET status = 'CANCELED', updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, class_id, schedule_id, room_id, date, start_minute, end_minute, status`,
    [sessionId, tenantId],
  );
  await c.query(
    "INSERT INTO session_changes (id, tenant_id, session_id, change_type, reason) VALUES ($1,$2,$3,'CANCEL',$4)",
    [randomUUID(), tenantId, sessionId, reason],
  );
  return toSession(r.rows[0] as SessRow);
}

export async function listSessions(c: Pg, tenantId: string, filter: { classId?: string; from?: string; to?: string }): Promise<Session[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.classId) { vals.push(filter.classId); conds.push(`class_id = $${vals.length}`); }
  if (filter.from) { vals.push(filter.from); conds.push(`date >= $${vals.length}`); }
  if (filter.to) { vals.push(filter.to); conds.push(`date <= $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, class_id, schedule_id, room_id, date, start_minute, end_minute, status
     FROM class_sessions WHERE ${conds.join(' AND ')} ORDER BY date, start_minute LIMIT 500`,
    vals,
  );
  return (r.rows as SessRow[]).map(toSession);
}

export async function sessionChanges(c: Pg, tenantId: string, sessionId: string): Promise<Array<{ changeType: string; reason: string; createdAt: string }>> {
  const r = await c.query(
    'SELECT change_type, reason, created_at FROM session_changes WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at',
    [tenantId, sessionId],
  );
  return (r.rows as Array<{ change_type: string; reason: string; created_at: Date | string }>).map((x) => ({
    changeType: x.change_type,
    reason: x.reason,
    createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : new Date(x.created_at).toISOString(),
  }));
}
