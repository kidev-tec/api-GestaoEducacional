/**
 * E09-01 — matriz de eventos de comunicação e fila local (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CommRuleError, upsertEventDef, listEventDefs, updateEventDef,
  enqueueMessage, deliverMessage, listMessages, commStats, syncFromOutbox, mapCommError,
} from '../src/comm-repositories.js';
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

const DEF = { id: 'd1', tenant_id: 'T', event_key: 'enrollment.created', channel: 'inapp', name: 'Matrícula criada', template_subject: 'Bem-vindo', template_body: 'Corpo {{student}}', enabled: true };
const MSG = { id: 'm1', tenant_id: 'T', event_key: 'enrollment.created', channel: 'inapp', recipient_user_id: null, lead_id: null, payload: '{}', status: 'QUEUED', skip_reason: null, created_at: new Date(), delivered_at: null };

describe('event defs', () => {
  it('upsert valida slug e body; lista; update enable/templates; 404', async () => {
    const { client, queries } = fakeClient((q) => (q.text.includes('INSERT INTO comm_event_defs') ? [DEF] : []));
    const d = await upsertEventDef(client, 'T', { eventKey: 'enrollment.created', channel: 'inapp', name: 'Matrícula criada', templateBody: 'Corpo' });
    expect(d.eventKey).toBe('enrollment.created');
    expect(d.enabled).toBe(true);
    expect(queries[0]!.text).toContain('ON CONFLICT');
    const { client: c0 } = fakeClient(() => []);
    await expect(upsertEventDef(c0, 'T', { eventKey: 'BAD KEY!', channel: 'inapp', name: 'x', templateBody: 'y' })).rejects.toThrow(CommRuleError);
    await expect(upsertEventDef(c0, 'T', { eventKey: 'ok.key', channel: 'inapp', name: 'x', templateBody: ' ' })).rejects.toThrow(CommRuleError);
    const { client: c1 } = fakeClient(() => [DEF]);
    expect(await listEventDefs(c1, 'T')).toHaveLength(1);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs WHERE id =')) return [{ id: 'd1' }];
      if (q.text.includes('UPDATE comm_event_defs')) return [{ ...DEF, enabled: false, template_subject: 'Novo' }];
      return [];
    });
    const up = await updateEventDef(c2, 'T', 'd1', { enabled: false, templateSubject: 'Novo' });
    expect(up.enabled).toBe(false);
    const { client: c3 } = fakeClient(() => []);
    await expect(updateEventDef(c3, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
  });
});

describe('enqueue (R2/R4)', () => {
  const defOk = (q: Q) => {
    if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF, id: 'd1' }];
    if (q.text.includes('FROM reminder_optouts')) return [];
    if (q.text.includes('INSERT INTO comm_messages')) return [MSG];
    return [];
  };
  it('def ausente/disabled → 422; opt-out → SKIPPED; ok → QUEUED', async () => {
    const { client } = fakeClient(defOk);
    const m = await enqueueMessage(client, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: { student: 'Zé' } });
    expect(m.status).toBe('QUEUED');
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [];
      return [];
    });
    await expect(enqueueMessage(c1, 'T', { eventKey: 'zz', channel: 'inapp', payload: {} })).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF, enabled: false }];
      return [];
    });
    await expect(enqueueMessage(c2, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: {} })).rejects.toThrow(CommRuleError);
    // opt-out
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF }];
      if (q.text.includes('FROM reminder_optouts')) return [{ opted_out_at: new Date() }];
      if (q.text.includes('INSERT INTO comm_messages')) return [{ ...MSG, status: 'SKIPPED', skip_reason: 'opt-out' }];
      return [];
    });
    const skipped = await enqueueMessage(c3, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: { a: 1 }, leadId: 'l1', recipientUserId: 'u2' });
    expect(skipped.status).toBe('SKIPPED');
    expect(skipped.skipReason).toBe('opt-out');
    // SKIPPED sem recipientUserId (?? null path)
    const { client: cd } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF }];
      if (q.text.includes('FROM reminder_optouts')) return [{ opted_out_at: new Date() }];
      if (q.text.includes('INSERT INTO comm_messages')) return [{ ...MSG, status: 'SKIPPED', skip_reason: 'opt-out' }];
      return [];
    });
    await enqueueMessage(cd, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: undefined as unknown as Record<string, never>, leadId: 'l1' });
  });
});

describe('deliver (R3)', () => {
  it('QUEUED→DELIVERED_LOCAL grava delivered_at; replay idempotente; SKIPPED→422', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...MSG }];
      if (q.text.includes("SET status = 'DELIVERED_LOCAL'")) return [{ ...MSG, status: 'DELIVERED_LOCAL', delivered_at: new Date() }];
      return [];
    });
    const d = await deliverMessage(client, 'T', 'm1');
    expect(d.status).toBe('DELIVERED_LOCAL');
    expect(d.deliveredAt).toBeTruthy();
    // já entregue → retorna como está (200)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...MSG, status: 'DELIVERED_LOCAL', delivered_at: new Date() }];
      return [];
    });
    const replay = await deliverMessage(c2, 'T', 'm1');
    expect(replay.status).toBe('DELIVERED_LOCAL');
    // SKIPPED → regra
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...MSG, status: 'SKIPPED' }];
      return [];
    });
    await expect(deliverMessage(c3, 'T', 'm1')).rejects.toThrow(CommRuleError);
    // 404
    const { client: c4 } = fakeClient(() => []);
    await expect(deliverMessage(c4, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('list/stats/sync', () => {
  it('filtros de list; stats agregados; sync outbox→comm', async () => {
    const { client, queries } = fakeClient(() => [MSG]);
    await listMessages(client, 'T', {});
    expect(queries[0]!.values).toEqual(['T']);
    await listMessages(client, 'T', { status: 'QUEUED', eventKey: 'enrollment.created' });
    expect(queries[1]!.values).toEqual(['T', 'QUEUED', 'enrollment.created']);
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('GROUP BY')) return [{ channel: 'inapp', status: 'QUEUED', n: 5 }, { channel: 'email', status: 'DELIVERED_LOCAL', n: 2 }];
      return [];
    });
    const st = await commStats(c1, 'T');
    expect(st).toHaveLength(2);
    // sync: outbox pendente enrollment.created → cria msgs p/ defs habilitados
    const { client: c2, queries: q2 } = fakeClient((q) => {
      if (q.text.includes('FROM outbox_events')) return [{ id: 'oe1', tenant_id: 'T', event_type: 'enrollment.created', payload: '{}' }];
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF }, { ...DEF, id: 'd2', channel: 'email' }];
      if (q.text.includes('FROM reminder_optouts')) return [];
      if (q.text.includes('INSERT INTO comm_messages')) return [MSG];
      if (q.text.includes('UPDATE outbox_events')) return [{ id: 'oe1' }];
      return [];
    });
    const sync = await syncFromOutbox(c2, 'T');
    expect(sync.created).toBe(2); // inapp + email
    expect(q2.some((q) => q.text.includes('UPDATE outbox_events'))).toBe(true);
    // sync sem outbox pendente
    const { client: c3 } = fakeClient(() => []);
    const sync2 = await syncFromOutbox(c3, 'T');
    expect(sync2.created).toBe(0);
  });
});

describe('branches finais comm', () => {
  it('paths: updateEventDef templateBody inválido; ?? null; toMsg delivered string; recipient/lead paths; sync def disabled', async () => {
    // updateEventDef templateBody vazio (60)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs WHERE id =')) return [{ id: 'd1' }];
      return [];
    });
    await expect(updateEventDef(c1, 'T', 'd1', { templateBody: ' ' })).rejects.toThrow(CommRuleError);
    // updateEventDef patch parcial (69 — ?? null)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs WHERE id =')) return [{ id: 'd1' }];
      if (q.text.includes('UPDATE comm_event_defs')) return [{ ...DEF, enabled: true }];
      return [];
    });
    await updateEventDef(c2, 'T', 'd1', { enabled: true, templateSubject: 'S', templateBody: 'B' });
    // paths ?? com valor: enabled/templateSubject null, templateBody fornecido
    const { client: cb } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs WHERE id =')) return [{ id: 'd1' }];
      if (q.text.includes('UPDATE comm_event_defs')) return [{ ...DEF, template_body: 'X' }];
      return [];
    });
    const rb = await updateEventDef(cb, 'T', 'd1', { templateBody: 'X' });
    expect(rb.templateBody).toBe('X');
    // toMsg delivered_at string (88)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_messages WHERE')) return [{ ...MSG, status: 'DELIVERED_LOCAL', delivered_at: '2026-11-11T10:00:00.000Z' }];
      return [];
    });
    const r3 = await deliverMessage(c3, 'T', 'm1');
    expect(r3.deliveredAt).toBe('2026-11-11T10:00:00.000Z');
    // enqueue com recipientUserId e leadId (112) e sem lead (121 — ?? null leadId)
    const { client: c4, queries: q4 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF }];
      if (q.text.includes('FROM reminder_optouts')) return [];
      if (q.text.includes('INSERT INTO comm_messages')) return [{ ...MSG, recipient_user_id: 'u1', lead_id: 'l1' }];
      return [];
    });
    const r4 = await enqueueMessage(c4, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: {}, recipientUserId: 'u1', leadId: 'l1' });
    expect(r4.recipientUserId).toBe('u1');
    const ins = q4.find((q) => q.text.includes('INSERT INTO comm_messages') && !q.text.includes('SKIPPED'))!;
    expect(ins.values[5]).toBe('l1');
    // payload undefined → ?? {} path
    const { client: ca } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF }];
      if (q.text.includes('FROM reminder_optouts')) return [];
      if (q.text.includes('INSERT INTO comm_messages')) return [MSG];
      return [];
    });
    await enqueueMessage(ca, 'T', { eventKey: 'enrollment.created', channel: 'inapp', payload: undefined as unknown as Record<string, never> });
    const insA = ca.queries.find((q) => q.text.includes('INSERT INTO comm_messages') && !q.text.includes('SKIPPED'))!;
    expect(insA.values[6]).toBe('{}');
    // sync com def disabled (179)
    const { client: c5, queries: q5 } = fakeClient((q) => {
      if (q.text.includes('FROM outbox_events')) return [{ id: 'oe2', tenant_id: 'T', event_type: 'enrollment.created', payload: '{}' }];
      if (q.text.includes('FROM comm_event_defs')) return [{ ...DEF, enabled: false }];
      if (q.text.includes('UPDATE outbox_events')) return [{ id: 'oe2' }];
      return [];
    });
    const sync = await syncFromOutbox(c5, 'T');
    expect(sync.created).toBe(0);
    expect(q5.some((q) => q.text.includes('UPDATE outbox_events'))).toBe(true);
  });
});

describe('mapCommError', () => {
  it('mapeia 422/404/500', () => {
    expect(mapCommError(new CommRuleError('x')).status).toBe(422);
    expect(mapCommError(new NotFoundError('x')).status).toBe(404);
    expect(mapCommError(new Error('x')).status).toBe(500);
  });
});
