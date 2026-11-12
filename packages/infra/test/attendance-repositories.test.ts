/**
 * E08-03 — chamada e presença auditável: lote, justificativa, atraso, revisão com trilha, report (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AttendanceRuleError, recordAttendance, reviseAttendance, attendanceReport, getSessionAttendance, attendanceChanges, mapAttendanceError,
} from '../src/attendance-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  return {
    queries,
    client: {
      query: vi.fn(async (...args: unknown[]) => {
        const q: Q = typeof args[0] === 'string'
          ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
          : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
        queries.push(q);
        const rows = responder(q);
        return { rows, rowCount: rows.length };
      }),
    } as unknown as import('pg').PoolClient & { queries: Q[] },
  };
}

const SESSION = { id: 's1', tenant_id: 'T', class_id: 'c1', status: 'SCHEDULED', date: '2026-11-10' };
const ENROLL = { id: 'en1', tenant_id: 'T', class_id: 'c1', student_id: 'st1' };
const ATT_ROW = { id: 'a1', tenant_id: 'T', session_id: 's1', enrollment_id: 'en1', status: 'PRESENT', minutes_late: 0, justification: null, recorded_by: 'u1', revised_by: null };

describe('recordAttendance', () => {
  it('lote: valida session/enrollment/status/justification/late; upsert por aluno', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions WHERE id')) return [{ ...SESSION }];
      if (q.text.includes('FROM enrollments WHERE id')) return [{ ...ENROLL }];
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND session_id = $2 AND enrollment_id')) return [];
      if (q.text.includes('INSERT INTO session_attendance')) return [{ ...ATT_ROW }];
      return [];
    });
    const r = await recordAttendance(client, 'T', {
      sessionId: 's1', recordedBy: 'u1',
      entries: [
        { enrollmentId: 'en1', status: 'PRESENT' },
        { enrollmentId: 'en2', status: 'LATE', minutesLate: 10 },
        { enrollmentId: 'en3', status: 'JUSTIFIED', justification: 'médico' },
      ],
    });
    expect(r).toHaveLength(3);
    expect(queries.filter((q) => q.text.includes('INSERT INTO session_attendance'))).toHaveLength(3);
    // session CANCELED → 422
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions WHERE id')) return [{ ...SESSION, status: 'CANCELED' }];
      return [];
    });
    await expect(recordAttendance(c1, 'T', { sessionId: 's1', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'PRESENT' }] }))
      .rejects.toThrow(/cancelad/);
    // JUSTIFIED sem justification → 422
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions WHERE id')) return [{ ...SESSION }];
      return [];
    });
    await expect(recordAttendance(c2, 'T', { sessionId: 's1', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'JUSTIFIED' }] }))
      .rejects.toThrow(/justificativa/);
    // LATE sem minutesLate → 422; LATE com 0 → 422
    await expect(recordAttendance(c2, 'T', { sessionId: 's1', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'LATE' }] }))
      .rejects.toThrow(/atraso/);
    await expect(recordAttendance(c2, 'T', { sessionId: 's1', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'LATE', minutesLate: 0 }] }))
      .rejects.toThrow(/atraso/);
    // enrollment de outra turma → 404 (não pertence)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions WHERE id')) return [{ ...SESSION }];
      if (q.text.includes('FROM enrollments WHERE id')) return [];
      return [];
    });
    await expect(recordAttendance(c3, 'T', { sessionId: 's1', recordedBy: 'u1', entries: [{ enrollmentId: 'zz', status: 'PRESENT' }] }))
      .rejects.toThrow(NotFoundError);
    // session inexistente → 404
    await expect(recordAttendance(c3, 'T', { sessionId: 'zz', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'PRESENT' }] }))
      .rejects.toThrow(NotFoundError);
  });
});

describe('reviseAttendance', () => {
  it('grava old→new na trilha, revised_by, exige reason, 404', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [{ ...ATT_ROW, status: 'ABSENT' }];
      if (q.text.includes('UPDATE session_attendance SET status')) return [{ ...ATT_ROW, status: 'JUSTIFIED', revised_by: 'u9' }];
      if (q.text.includes('INSERT INTO attendance_changes')) return [];
      return [];
    });
    const r = await reviseAttendance(client, 'T', 'a1', { newStatus: 'JUSTIFIED', reason: 'atestado recebido', reviewerId: 'u9', justification: 'atestado anexo' });
    expect(r.status).toBe('JUSTIFIED');
    expect(r.revisedBy).toBe('u9');
    expect(queries.some((q) => q.text.includes('INSERT INTO attendance_changes'))).toBe(true);
    // sem reason → 422
    const { client: c1 } = fakeClient(() => []);
    await expect(reviseAttendance(c1, 'T', 'a1', { newStatus: 'PRESENT', reason: '', reviewerId: 'u9' })).rejects.toThrow(/motivo/);
    // 404
    await expect(reviseAttendance(c1, 'T', 'zz', { newStatus: 'PRESENT', reason: 'x', reviewerId: 'u9' })).rejects.toThrow(NotFoundError);
  });
});

describe('branches finais attendance', () => {
  it('status inválido, 404 sessão, upsert existente, revisão variantes, student_name null, total 0', async () => {
    // status inválido (35): 'FERIAS'
    const { client: c0 } = fakeClient(() => []);
    await expect(recordAttendance(c0, 'T', { sessionId: 's', recordedBy: 'u', entries: [{ enrollmentId: 'e', status: 'FERIAS' }] }))
      .rejects.toThrow(/status inválido/);
    // 404 sessão (45): c0 já retorna []
    await expect(recordAttendance(c0, 'T', { sessionId: 's', recordedBy: 'u', entries: [{ enrollmentId: 'e', status: 'PRESENT' }] }))
      .rejects.toThrow(NotFoundError);
    // upsert existente (59 true path): existing retorna row → UPDATE
    const SESSION2 = { id: 's2', tenant_id: 'T', class_id: 'c2', status: 'SCHEDULED', date: '2026-11-11' };
    const { client: c1, queries } = fakeClient((q) => {
      if (q.text.includes('FROM class_sessions WHERE id')) return [{ ...SESSION2 }];
      if (q.text.includes('FROM enrollments WHERE id')) return [{ id: 'en1', tenant_id: 'T' }];
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND session_id = $2 AND enrollment_id')) return [{ id: 'ax', status: 'ABSENT' }];
      if (q.text.includes('UPDATE session_attendance SET status')) return [{ ...ATT_ROW, status: 'PRESENT', session_id: 's2' }];
      return [];
    });
    const up = await recordAttendance(c1, 'T', { sessionId: 's2', recordedBy: 'u1', entries: [{ enrollmentId: 'en1', status: 'PRESENT' }] });
    expect(up[0]!.sessionId).toBe('s2');
    expect(queries.some((q) => q.text.includes('UPDATE session_attendance SET status'))).toBe(true);
    // revisão: JUSTIFIED com justification na row (87 false path), LATE herda minutes (90), justification da row (91)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [{ ...ATT_ROW, status: 'ABSENT', justification: 'laudo prévio', minutes_late: 7 }];
      if (q.text.includes('UPDATE session_attendance SET status')) return [{ ...ATT_ROW, status: 'JUSTIFIED', revised_by: 'u9' }];
      if (q.text.includes('INSERT INTO attendance_changes')) return [];
      return [];
    });
    await reviseAttendance(c2, 'T', 'a1', { newStatus: 'JUSTIFIED', reason: 'ok', reviewerId: 'u9' });
    // JUSTIFIED sem justification em lugar nenhum → throw
    const { client: c2b } = fakeClient((q) => {
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [{ ...ATT_ROW, status: 'ABSENT', justification: null }];
      return [];
    });
    await expect(reviseAttendance(c2b, 'T', 'a1', { newStatus: 'JUSTIFIED', reason: 'ok', reviewerId: 'u9' })).rejects.toThrow(/justificativa/);
    // revisão para LATE (minutes herda 7)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [{ ...ATT_ROW, status: 'PRESENT', minutes_late: 7 }];
      if (q.text.includes('UPDATE session_attendance SET status')) return [{ ...ATT_ROW, status: 'LATE', revised_by: 'u9' }];
      if (q.text.includes('INSERT INTO attendance_changes')) return [];
      return [];
    });
    await reviseAttendance(c3, 'T', 'a1', { newStatus: 'LATE', reason: 'chegou depois', reviewerId: 'u9' });
    // LATE com minutes_late 0 → fallback 1
    const { client: c3b } = fakeClient((q) => {
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [{ ...ATT_ROW, status: 'PRESENT', minutes_late: 0 }];
      if (q.text.includes('UPDATE session_attendance SET status')) return [{ ...ATT_ROW, status: 'LATE' }];
      if (q.text.includes('INSERT INTO attendance_changes')) return [];
      return [];
    });
    await reviseAttendance(c3b, 'T', 'a1', { newStatus: 'LATE', reason: 'x', reviewerId: 'u9' });
    // report com student_name null (122) e total 0 impossível... total>0 sempre quando row existe;
    // percent path: total 0 não ocorre por linha — mas student_name null sim
    const rows2 = [{ enrollment_id: 'en9', student_name: null, status: 'PRESENT' }];
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('session_attendance sa') || q.text.includes('COUNT(DISTINCT')) return rows2;
      return [];
    });
    const rep2 = await attendanceReport(c4, 'T', 'cX', { from: '2026-01-01', to: '2026-12-31' });
    expect(rep2[0]!.studentName).toBe('en9');
    expect(rep2[0]!.percent).toBe(100);
  });
});

describe('report + list + changes + map', () => {
  it('percentuais: presenças = PRESENT+LATE; report por aluno; list; trilha; map', async () => {
    const rows = [
      { enrollment_id: 'en1', student_name: 'Ana', status: 'PRESENT' },
      { enrollment_id: 'en1', student_name: 'Ana', status: 'LATE' },
      { enrollment_id: 'en1', student_name: 'Ana', status: 'ABSENT' },
      { enrollment_id: 'en1', student_name: 'Ana', status: 'JUSTIFIED' },
      { enrollment_id: 'en2', student_name: 'Bob', status: 'ABSENT' },
      { enrollment_id: 'en2', student_name: 'Bob', status: 'ABSENT' },
    ];
    const { client } = fakeClient((q) => {
      if (q.text.includes('session_attendance sa') || q.text.includes('COUNT(DISTINCT')) return rows;
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND session_id')) return [ATT_ROW];
      if (q.text.includes('FROM session_attendance WHERE tenant_id = $1 AND id')) return [ATT_ROW];
      if (q.text.includes('FROM attendance_changes')) return [{ old_status: 'ABSENT', new_status: 'JUSTIFIED', reason: 'x', changed_by: 'u9', created_at: new Date() }];
      return [];
    });
    const rep = await attendanceReport(client, 'T', 'c1', { from: '2026-11-01', to: '2026-11-30' });
    const ana = rep.find((x) => x.studentName === 'Ana')!;
    expect(ana.total).toBe(4);
    expect(ana.presentCount).toBe(2); // PRESENT + LATE
    expect(ana.justified).toBe(1);
    expect(ana.absent).toBe(1);
    expect(ana.percent).toBe(50); // 2/4
    const bob = rep.find((x) => x.studentName === 'Bob')!;
    expect(bob.percent).toBe(0);
    const list = await getSessionAttendance(client, 'T', 's1');
    expect(list).toHaveLength(1);
    const ch = await attendanceChanges(client, 'T', 'a1');
    expect(ch).toHaveLength(1);
    const { client: c1 } = fakeClient(() => []);
    expect(await getSessionAttendance(c1, 'T', 'zz')).toHaveLength(0);
    expect(mapAttendanceError(new AttendanceRuleError('x')).status).toBe(422);
    expect(mapAttendanceError(new NotFoundError('x')).status).toBe(404);
    expect(mapAttendanceError(new Error('x')).status).toBe(500);
  });
});
