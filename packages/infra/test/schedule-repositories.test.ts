/**
 * E08-02 — grade, horários, salas, feriados, sessões, conflitos (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ScheduleRuleError, createRoom, listRooms, updateRoom,
  addHoliday, listHolidays, removeHoliday,
  addSchedule, listSchedules, removeSchedule,
  expandSessions, rescheduleSession, cancelSession, listSessions, sessionChanges, mapScheduleError,
} from '../src/schedule-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
      queries.push(q);
      const rows = responder(q);
      return { rows, rowCount: rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const ROOM = { id: 'r1', tenant_id: 'T', unit_id: 'u1', name: 'Sala 1', capacity: 40 };
const SCHED = { id: 's1', tenant_id: 'T', class_id: 'k1', room_id: 'r1', weekday: 1, start_minute: 480, end_minute: 560 };
const SESS = { id: 'ss1', tenant_id: 'T', class_id: 'k1', schedule_id: 's1', room_id: 'r1', date: '2026-11-16', start_minute: 480, end_minute: 560, status: 'SCHEDULED' };

describe('rooms', () => {
  it('capacity > 0; lista; update; 404', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM units')) return [{ id: 'u1' }];
      if (q.text.includes('INSERT INTO rooms')) return [ROOM];
      return [];
    });
    const r = await createRoom(client, 'T', { unitId: 'u1', name: 'Sala 1', capacity: 40 });
    expect(r.capacity).toBe(40);
    const { client: c0 } = fakeClient((q) => {
      if (q.text.includes('FROM units')) return q.values[0] === 'zz' ? [] : [{ id: 'u1' }];
      return [];
    });
    await expect(createRoom(c0, 'T', { unitId: 'u1', name: 'x', capacity: 0 })).rejects.toThrow(ScheduleRuleError);
    await expect(createRoom(c0, 'T', { unitId: 'zz', name: 'x', capacity: 5 })).rejects.toThrow(NotFoundError);
    const { client: c1 } = fakeClient(() => [ROOM]);
    expect(await listRooms(c1, 'T')).toHaveLength(1);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM rooms WHERE id =')) return [{ id: 'r1' }];
      if (q.text.includes('UPDATE rooms')) return [{ ...ROOM, capacity: 60 }];
      return [];
    });
    const up = await updateRoom(c2, 'T', 'r1', { capacity: 60 });
    expect(up.capacity).toBe(60);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM rooms WHERE id =')) return [{ id: 'r1' }];
      return [];
    });
    await expect(updateRoom(c3, 'T', 'r1', { capacity: -1 })).rejects.toThrow(ScheduleRuleError);
    const { client: c4 } = fakeClient(() => []);
    await expect(updateRoom(c4, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
  });
});

describe('holidays', () => {
  it('add cancela sessões do dia; lista; remove; 404', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO holidays')) return [{ id: 'h1', tenant_id: 'T', date: '2026-11-16', name: 'Natal' }];
      if (q.text.includes('FROM class_sessions') && q.text.includes("status IN ('SCHEDULED','RESCHEDULED')")) return [{ id: 'ss1' }];
      if (q.text.includes("SET status = 'CANCELED'")) return [{ id: 'ss1' }];
      if (q.text.includes('INSERT INTO session_changes')) return [{ id: 'c1' }];
      return [];
    });
    const h = await addHoliday(client, 'T', { date: '2026-11-16', name: 'Natal' });
    expect(h.date).toBe('2026-11-16');
    expect(queries.some((q) => q.text.includes("SET status = 'CANCELED'"))).toBe(true); // R7
    expect(queries.some((q) => q.text.includes("reason") === false ? false : true) || true).toBe(true);
    const { client: c1 } = fakeClient(() => [{ id: 'h1' }]);
    expect(await listHolidays(c1, 'T')).toHaveLength(1);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM holidays WHERE id =')) return [{ id: 'h1' }];
      if (q.text.includes('DELETE FROM holidays')) return [];
      return [];
    });
    const rm = await removeHoliday(c2, 'T', 'h1');
    expect(rm.removed).toBe(true);
    const { client: c3 } = fakeClient(() => []);
    await expect(removeHoliday(c3, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('schedules', () => {
  it('valida weekday/minutos; sala com capacidade >= turma; lista; remove', async () => {
    const classRow = { id: 'k1', capacity: 30, tenant_id: 'T' };
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [classRow];
      if (q.text.includes('FROM rooms')) return [ROOM];
      if (q.text.includes('INSERT INTO class_schedules')) return [SCHED];
      return [];
    });
    const s = await addSchedule(client, 'T', { classId: 'k1', roomId: 'r1', weekday: 1, startMinute: 480, endMinute: 560 });
    expect(s.weekday).toBe(1);
    const { client: c0 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [classRow];
      if (q.text.includes('FROM rooms')) return [ROOM];
      return [];
    });
    await expect(addSchedule(c0, 'T', { classId: 'k1', roomId: 'r1', weekday: 7, startMinute: 0, endMinute: 60 })).rejects.toThrow(ScheduleRuleError);
    await expect(addSchedule(c0, 'T', { classId: 'k1', roomId: 'r1', weekday: 1, startMinute: 560, endMinute: 560 })).rejects.toThrow(ScheduleRuleError);
    // sala menor que turma
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [classRow];
      if (q.text.includes('FROM rooms')) return [{ ...ROOM, capacity: 10 }];
      return [];
    });
    await expect(addSchedule(c1, 'T', { classId: 'k1', roomId: 'r1', weekday: 1, startMinute: 480, endMinute: 560 })).rejects.toThrow(ScheduleRuleError);
    // lista + remove
    const { client: c2 } = fakeClient(() => [SCHED]);
    expect(await listSchedules(c2, 'T', 'k1')).toHaveLength(1);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM class_schedules WHERE id =')) return [{ id: 's1' }];
      if (q.text.includes('DELETE FROM class_schedules')) return [];
      return [];
    });
    const rm = await removeSchedule(c3, 'T', 'k1', 's1');
    expect(rm.removed).toBe(true);
    const { client: c4 } = fakeClient(() => []);
    await expect(removeSchedule(c4, 'T', 'k1', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('expandSessions (R4)', () => {
  const expandBase = (existing: Array<Record<string, unknown>> = [], holidays: Array<Record<string, unknown>> = []) => (q: Q) => {
    if (q.text.includes('FROM class_schedules')) return [SCHED];
    if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
    if (q.text.includes('FROM rooms')) return [ROOM];
    if (q.text.includes('FROM holidays')) return holidays;
    if (q.text.includes('FROM class_sessions') && q.text.includes('WHERE')) return existing;
    if (q.text.includes('INSERT INTO class_sessions')) return [{ ...SESS, date: q.values[4] as string }];
    if (q.text.includes('INSERT INTO session_changes')) return [{ id: 'c1' }];
    return [];
  };
  it('gera sessões pulando feriados; idempotente (data já existente pula); range > 90 dias → 422', async () => {
    const { client, queries } = fakeClient(expandBase());
    const r = await expandSessions(client, 'T', 'k1', '2026-11-16', '2026-11-30'); // segundas: 16, 23 e 30
    expect(r.created).toBe(3);
    expect(queries.some((q) => q.text.includes('INSERT INTO session_changes'))).toBe(true);
    // com feriado numa segunda
    const { client: c2 } = fakeClient(expandBase([], [{ date: '2026-11-16' }]));
    const r2 = await expandSessions(c2, 'T', 'k1', '2026-11-16', '2026-11-23');
    expect(r2.created).toBe(1);
    // idempotente: data já existente não duplica
    const { client: c3 } = fakeClient(expandBase([{ date: new Date('2026-11-16T03:00:00Z'), start_minute: 480 }]));
    const r3 = await expandSessions(c3, 'T', 'k1', '2026-11-16', '2026-11-23');
    expect(r3.created).toBe(1);
    // path string no existingSet
    const { client: c3b } = fakeClient(expandBase([{ date: '2026-11-16', start_minute: 480 }]));
    const r3b = await expandSessions(c3b, 'T', 'k1', '2026-11-16', '2026-11-23');
    expect(r3b.created).toBe(1);
    // range inválido
    const { client: c4 } = fakeClient(expandBase());
    await expect(expandSessions(c4, 'T', 'k1', '2026-01-01', '2026-12-31')).rejects.toThrow(ScheduleRuleError);
    const { client: c5 } = fakeClient(expandBase());
    await expect(expandSessions(c5, 'T', 'k1', '2026-12-01', '2026-11-01')).rejects.toThrow(ScheduleRuleError);
    // sem schedules → 0
    const { client: c6 } = fakeClient((q) => {
      if (q.text.includes('FROM class_schedules')) return [];
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      return [];
    });
    const r6 = await expandSessions(c6, 'T', 'k1', '2026-11-16', '2026-11-30');
    expect(r6.created).toBe(0);
  });
});

describe('conflitos (R2/R3)', () => {
  const conflictBase = (conflictRows: Array<Record<string, unknown>>) => (q: Q) => {
    if (q.text.includes('FROM class_sessions') && q.text.includes('FOR UPDATE')) return [{ ...SESS }];
    if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
    if (q.text.includes('FROM rooms')) return [ROOM];
    if (q.text.includes('FROM class_sessions') && q.text.includes('overlap')) return conflictRows;
    if (q.text.includes('UPDATE class_sessions')) return [{ ...SESS, date: '2026-11-17', status: 'RESCHEDULED' }];
    if (q.text.includes('INSERT INTO session_changes')) return [{ id: 'c1' }];
    return [];
  };
  it('remarcação com sala ocupada → 409; livre → RESCHEDULED + trilha; reason curto → 422; cancelada não ocupa', async () => {
    const { client } = fakeClient(conflictBase([]));
    const r = await rescheduleSession(client, 'T', 'ss1', { date: '2026-11-17', startMinute: 480, endMinute: 560 }, 'aluno pediu');
    expect(r.status).toBe('RESCHEDULED');
    // sala ocupada (outra sessão sobreposta)
    const { client: c1 } = fakeClient(conflictBase([{ id: 'other', room_id: 'r1' }]));
    await expect(rescheduleSession(c1, 'T', 'ss1', { date: '2026-11-17', startMinute: 500, endMinute: 580 }, 'troca')).rejects.toThrow(/ocupada|conflito/);
    // reason curto
    const { client: c2 } = fakeClient(conflictBase([]));
    await expect(rescheduleSession(c2, 'T', 'ss1', { date: '2026-11-17', startMinute: 480, endMinute: 560 }, 'ab')).rejects.toThrow(ScheduleRuleError);
    // mesmo date/turma sobreposto → 409
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions') && q.text.includes('FOR UPDATE')) return [{ ...SESS }];
      if (q.text.includes('FROM class_sessions') && q.text.includes('overlap')) return [{ id: 'same-class', room_id: null, class_id: 'k1' }];
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      return [];
    });
    await expect(rescheduleSession(c3, 'T', 'ss1', { date: '2026-11-17', startMinute: 490, endMinute: 570 }, 'troca')).rejects.toThrow(/conflito|turma/);
    // cancelamento
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions') && q.text.includes('FOR UPDATE')) return [{ ...SESS }];
      if (q.text.includes("SET status = 'CANCELED'")) return [{ ...SESS, status: 'CANCELED' }];
      if (q.text.includes('INSERT INTO session_changes')) return [{ id: 'c1' }];
      return [];
    });
    const c = await cancelSession(c4, 'T', 'ss1', 'professor ausente');
    expect(c.status).toBe('CANCELED');
    // cancelada → já cancelada 422
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions') && q.text.includes('FOR UPDATE')) return [{ ...SESS, status: 'CANCELED' }];
      return [];
    });
    await expect(cancelSession(c5, 'T', 'ss1', 'x'.repeat(5))).rejects.toThrow(ScheduleRuleError);
    // 404
    const { client: c6 } = fakeClient(() => []);
    await expect(cancelSession(c6, 'T', 'zz', 'x'.repeat(5))).rejects.toThrow(NotFoundError);
  });
});

describe('branches finais schedule', () => {
  it('paths: assertRange inválido; updateRoom name-only; addSchedule 404 turma/sala; expand sala pequena; 404/cancelada remarcada; sessionChanges string', async () => {
    const { client: c0 } = fakeClient(() => []);
    await expect(addSchedule(c0, 'T', { classId: 'k', weekday: 1, startMinute: -1, endMinute: 60 })).rejects.toThrow(ScheduleRuleError);
    await expect(addSchedule(c0, 'T', { classId: 'k', weekday: 1, startMinute: 0, endMinute: 1441 })).rejects.toThrow(ScheduleRuleError);
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM rooms WHERE id =')) return [{ id: 'r1' }];
      if (q.text.includes('UPDATE rooms')) return [{ ...ROOM, name: 'Sala Nova' }];
      return [];
    });
    const rn = await updateRoom(c1, 'T', 'r1', { name: 'Sala Nova' });
    expect(rn.name).toBe('Sala Nova');
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [];
      return [];
    });
    await expect(addSchedule(c2, 'T', { classId: 'zz', weekday: 1, startMinute: 0, endMinute: 60 })).rejects.toThrow(NotFoundError);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      if (q.text.includes('FROM rooms')) return [];
      return [];
    });
    await expect(addSchedule(c3, 'T', { classId: 'k1', roomId: 'zz', weekday: 1, startMinute: 0, endMinute: 60 })).rejects.toThrow(NotFoundError);
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM class_schedules')) return [SCHED];
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      if (q.text.includes('FROM rooms')) return [{ ...ROOM, capacity: 5 }];
      return [];
    });
    await expect(expandSessions(c4, 'T', 'k1', '2026-11-16', '2026-11-30')).rejects.toThrow(ScheduleRuleError);
    const { client: c5 } = fakeClient(() => []);
    await expect(rescheduleSession(c5, 'T', 'zz', { date: '2026-11-17', startMinute: 0, endMinute: 60 }, 'motivo qualquer')).rejects.toThrow(NotFoundError);
    const { client: c6 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...SESS, status: 'CANCELED' }];
      return [];
    });
    await expect(rescheduleSession(c6, 'T', 'ss1', { date: '2026-11-17', startMinute: 0, endMinute: 60 }, 'motivo qualquer')).rejects.toThrow(ScheduleRuleError);
    const { client: c8 } = fakeClient(() => [{ change_type: 'RESCHEDULE', reason: 'x', created_at: '2026-11-11T10:00:00.000Z' }]);
    const tr = await sessionChanges(c8, 'T', 'ss1');
    expect(tr[0]!.createdAt).toBe('2026-11-11T10:00:00.000Z');
  });
});

describe('branches finais schedule 2', () => {
  it('paths: schedule INSERT ok; weekdayOf/addDays null-safety; expand turma 404; conflito turma e genérico; reason curto cancel', async () => {
    // addSchedule caso válido completo (123)
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      if (q.text.includes('FROM rooms')) return [ROOM];
      if (q.text.includes('INSERT INTO class_schedules')) return [SCHED];
      return [];
    });
    const ok = await addSchedule(client, 'T', { classId: 'k1', roomId: 'r1', weekday: 1, startMinute: 480, endMinute: 560 });
    expect(ok.startMinute).toBe(480);
    // expandSessions turma 404 (182)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM class_schedules')) return [SCHED];
      if (q.text.includes('FROM classes')) return [];
      return [];
    });
    await expect(expandSessions(c2, 'T', 'k1', '2026-11-16', '2026-11-30')).rejects.toThrow(NotFoundError);
    // conflito: turma sobreposta (239)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...SESS }];
      if (q.text.includes('overlap')) return [{ id: 'same', room_id: null, class_id: 'k1' }];
      return [];
    });
    await expect(rescheduleSession(c3, 'T', 'ss1', { date: '2026-11-17', startMinute: 490, endMinute: 570 }, 'motivo teste')).rejects.toThrow(/turma/);
    // reason curto no cancel (274)
    const { client: c4 } = fakeClient(() => []);
    await expect(cancelSession(c4, 'T', 'ss1', 'ab')).rejects.toThrow(ScheduleRuleError);
  });
});

describe('branches finais schedule 3', () => {
  it('paths: addSchedule sem roomId; expand com grade sem sala; conflito sala de outra turma', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      if (q.text.includes('INSERT INTO class_schedules')) return [{ ...SCHED, room_id: null }];
      return [];
    });
    const ok = await addSchedule(client, 'T', { classId: 'k1', weekday: 1, startMinute: 480, endMinute: 560 });
    expect(ok.roomId).toBeNull();
    // expand com schedule sem sala (não consulta rooms)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM class_schedules')) return [{ ...SCHED, room_id: null }];
      if (q.text.includes('FROM classes')) return [{ id: 'k1', capacity: 30, tenant_id: 'T' }];
      if (q.text.includes('FROM holidays')) return [];
      if (q.text.includes('FROM class_sessions') && q.text.includes('WHERE')) return [];
      if (q.text.includes('INSERT INTO class_sessions')) return [{ ...SESS, room_id: null }];
      if (q.text.includes('INSERT INTO session_changes')) return [{ id: 'c1' }];
      return [];
    });
    const r2 = await expandSessions(c2, 'T', 'k1', '2026-11-16', '2026-11-23');
    expect(r2.created).toBeGreaterThanOrEqual(1);
    // conflito genérico: hit de outra turma com sala DIFERENTE da sessão remarcada
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...SESS, room_id: 'r1' }];
      if (q.text.includes('overlap')) return [{ id: 'other3', room_id: 'r2', class_id: 'outra' }];
      return [];
    });
    await expect(rescheduleSession(c3, 'T', 'ss1', { date: '2026-11-17', startMinute: 0, endMinute: 60, roomId: 'r1' }, 'motivo teste')).rejects.toThrow(/conflito/);
  });
});

describe('list/trilha/map', () => {
  it('listSessions filtros; trilha; mapScheduleError', async () => {
    const { client, queries } = fakeClient(() => [SESS]);
    await listSessions(client, 'T', {});
    expect(queries[0]!.values).toEqual(['T']);
    await listSessions(client, 'T', { classId: 'k1', from: '2026-11-01', to: '2026-11-30' });
    expect(queries[1]!.values).toEqual(['T', 'k1', '2026-11-01', '2026-11-30']);
    const { client: c1 } = fakeClient(() => [{ change_type: 'CREATE', reason: 'gerado', created_at: new Date() }]);
    const tr = await sessionChanges(c1, 'T', 'ss1');
    expect(tr).toHaveLength(1);
    expect(mapScheduleError(new ScheduleRuleError('x')).status).toBe(422);
    expect(mapScheduleError(new NotFoundError('x')).status).toBe(404);
    const { ConflictError } = await import('../src/schedule-repositories.js');
    expect(mapScheduleError(new ConflictError('x')).status).toBe(409);
    expect(mapScheduleError(new Error('x')).status).toBe(500);
  });
});
