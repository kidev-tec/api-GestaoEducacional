/**
 * E06-C unit — task-repositories com fake pg. Cobertura 100×4.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  addToRotation, cancelTask, completeTask, createTask, getTimeline, listTasks,
  nextInRotation, removeFromRotation, TaskRuleError,
} from '../src/task-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Row = Record<string, unknown>;
interface Q { text: string; values: unknown[] }

function fakeClient(script: (q: Q) => Row[] | undefined) {
  const queries: Q[] = [];
  const client = {
    query: vi.fn(async (q: Q | string, values?: unknown[]) => {
      const norm: Q = typeof q === 'string' ? { text: q, values: values ?? [] } : { ...q, values: q.values ?? values ?? [] };
      queries.push(norm);
      const rows = script(norm) ?? [];
      return { rows, rowCount: rows.length };
    }),
  };
  return { client: client as unknown as import('pg').PoolClient, queries };
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const TASK = { id: 't1', lead_id: 'l1', assigned_to: 'u1', kind: 'call' as const, status: 'open' as const, due_at: FUTURE, done_at: null, cancel_reason: null, notes: null };

describe('createTask', () => {
  it('valida kind, due futuro e lead existente', async () => {
    const { client } = fakeClient(() => []);
    await expect(createTask(client, 'T', { leadId: 'l', assignedTo: 'u', kind: 'bad' as 'call', dueAt: FUTURE })).rejects.toThrow(TaskRuleError);
    await expect(createTask(client, 'T', { leadId: 'l', assignedTo: 'u', kind: 'call', dueAt: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/future/);
    await expect(createTask(client, 'T', { leadId: 'l', assignedTo: 'u', kind: 'call', dueAt: FUTURE })).rejects.toThrow(NotFoundError);
  });
  it('cria com audit', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM leads')) return [{ id: 'l1' }];
      if (q.text.includes('INSERT INTO crm_tasks')) return [TASK];
      return [];
    });
    const t = await createTask(client, 'T', { leadId: 'l1', assignedTo: 'u1', kind: 'call', dueAt: FUTURE, notes: 'n' });
    expect(t.id).toBe('t1');
    expect(queries.some((q) => q.text.includes('audit_records'))).toBe(true);
  });
});

describe('completeTask', () => {
  it('404, cancelada→422, ok idempotente set done', async () => {
    const { client } = fakeClient(() => []);
    await expect(completeTask(client, 'T', 'z', 'u')).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient(() => [{ status: 'canceled' }]);
    await expect(completeTask(c2, 'T', 't', 'u')).rejects.toThrow(/canceled/);
    const { client: c3, queries } = fakeClient((q) => (q.text.includes('FOR UPDATE') ? [{ status: 'open' }] : q.text.includes('UPDATE crm_tasks') ? [{ ...TASK, status: 'done' }] : []));
    const done = await completeTask(c3, 'T', 't1', 'u');
    expect(done.status).toBe('done');
    expect(queries.some((q) => q.text.includes('audit_records') && q.values.includes('crm.task.done'))).toBe(true);
  });
});

describe('cancelTask', () => {
  it('razão curta, done não cancela, ok', async () => {
    const { client } = fakeClient(() => []);
    await expect(cancelTask(client, 'T', 't', 'ab', 'u')).rejects.toThrow(TaskRuleError);
    const { client: c2 } = fakeClient((q) => (q.text.includes('FOR UPDATE') ? [{ status: 'done' }] : []));
    await expect(cancelTask(c2, 'T', 't', 'razão ok', 'u')).rejects.toThrow(/done/);
    const { client: c3 } = fakeClient((q) => (q.text.includes('FOR UPDATE') ? [{ status: 'open' }] : q.text.includes('UPDATE crm_tasks') ? [{ ...TASK, status: 'canceled', cancel_reason: 'razão ok' }] : []));
    const r = await cancelTask(c3, 'T', 't', '  razão ok  ', 'u');
    expect(r.status).toBe('canceled');
  });
});

describe('listTasks', () => {
  it('filtros + clamp', async () => {
    const { client, queries } = fakeClient(() => [TASK]);
    await listTasks(client, 'T', { assignedTo: 'u1', status: 'open', overdue: true, limit: 999 });
    const q = queries[0];
    expect(q.text).toContain('assigned_to =');
    expect(q.text).toContain("status = 'open' AND due_at < now()");
    expect(q.text).toContain('LIMIT 200');
    await listTasks(client, 'T');
  });
});

describe('round-robin', () => {
  it('nextInRotation retorna user e falha com rotação vazia', async () => {
    const { client } = fakeClient(() => []);
    await expect(nextInRotation(client, 'T')).rejects.toThrow(/rotation empty/);
    const { client: c2 } = fakeClient(() => [{ user_id: 'u2' }]);
    const u = await nextInRotation(c2, 'T');
    expect(u).toBe('u2');
  });
  it('add/remove rotação', async () => {
    const { client, queries } = fakeClient((q) => (q.text.includes('MAX(position)') ? [{ m: '5' }] : []));
    await addToRotation(client, 'T', 'u9');
    const ins = queries.find((q) => q.text.includes('INSERT INTO crm_rotation'))!;
    expect(ins.values[2]).toBe(6);
    const { client: c2 } = fakeClient(() => []);
    await expect(removeFromRotation(c2, 'T', 'zz')).rejects.toThrow(NotFoundError);
    const { client: c3 } = fakeClient(() => []);
    (c3 as unknown as { query: ReturnType<typeof vi.fn> }).query.mockReturnValueOnce(Promise.resolve({ rows: [], rowCount: 1 }));
    await removeFromRotation(c3, 'T', 'u1');
  });
});

describe('getTimeline', () => {
  it('404 lead, mescla stage+tasks ordenado', async () => {
    const { client } = fakeClient(() => []);
    await expect(getTimeline(client, 'T', 'z')).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM leads')) return [{ id: 'l1' }];
      if (q.text.includes('lead_stage_history'))
        return [{ at: '2026-01-02T00:00:00Z', from_l: 'Novo', to_l: 'Contato' }, { at: '2026-01-01T00:00:00Z', from_l: '(início)', to_l: 'Novo' }];
      if (q.text.includes('crm_tasks'))
        return [{ at: '2026-01-01T12:00:00Z', kind: 'call', status: 'open', due_at: FUTURE }];
      return [];
    });
    const tl = await getTimeline(c2, 'T', 'l1');
    expect(tl).toHaveLength(3);
    expect(tl[0].at).toBe('2026-01-01T00:00:00.000Z');
    expect(tl[0].label).toContain('(início)');
    expect(tl[1].type).toBe('task');
    expect(tl[2].type).toBe('stage');
  });
});

describe('getSlaHours via settings', () => {
  it('default 48 e valor custom válido', async () => {
    const { client } = fakeClient(() => []);
    expect(await getSlaHoursDirect(client, 'T')).toBe(48);
    const { client: c2 } = fakeClient(() => [{ value: '24' }]);
    expect(await getSlaHoursDirect(c2, 'T')).toBe(24);
  });
});

import { getSlaHours as getSlaHoursDirect } from '../src/task-repositories.js';

describe('branches finais task', () => {
  it('completeTask 404 fake rowCount via SELECT missing; toIso string path; SLA inválida', async () => {
    // toIso com Date (path Date)
    const { client: cTl } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM leads')) return [{ id: 'l1' }];
      if (q.text.includes('lead_stage_history'))
        return [{ at: new Date('2026-01-02T00:00:00Z'), from_l: 'A', to_l: 'B' }];
      if (q.text.includes('crm_tasks'))
        return [{ at: new Date('2026-01-01T00:00:00Z'), kind: 'call', status: 'open', due_at: new Date('2026-01-03T00:00:00Z') }];
      return [];
    });
    const tl = await getTimeline(cTl, 'T', 'l1');
    expect(tl[0].at).toBe('2026-01-01T00:00:00.000Z');
    // SLA inválida → 48
    const { client: cSla } = fakeClient(() => [{ value: 'abc' }]);
    expect(await getSlaHoursDirect(cSla, 'T')).toBe(48);
    const { client: cSla2 } = fakeClient(() => [{ value: '-5' }]);
    expect(await getSlaHoursDirect(cSla2, 'T')).toBe(48);
  });
});

describe('branches: notes ?? null e cancelTask 404', () => {
  it('createTask sem notes (null) e cancelTask de tarefa inexistente', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM leads')) return [{ id: 'l1' }];
      if (q.text.includes('INSERT INTO crm_tasks')) return [{ ...TASK, notes: null }];
      return [];
    });
    await createTask(client, 'T', { leadId: 'l1', assignedTo: 'u1', kind: 'visit', dueAt: FUTURE });
    const ins = queries.find((q) => q.text.includes('INSERT INTO crm_tasks'))!;
    expect(ins.values[5]).toBeNull();
    const { client: c2 } = fakeClient(() => []);
    await expect(cancelTask(c2, 'T', 'zz', 'razão válida', 'u')).rejects.toThrow(NotFoundError);
  });
});
