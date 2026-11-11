/**
 * E06-08 unit — reminder-repositories 100×4 (fake PG).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ReminderRuleError, createPolicy, updatePolicy, listPolicies, optOut, optOutStatus,
  generateReminders, dispatchReminders, listReminders, mapReminderError,
} from '../src/reminder-repositories.js';
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

const POL = { id: 'p1', tenant_id: 'T', name: 'due-60', enabled: true, kind: 'TASK_DUE', offset_minutes: 60, channel: 'inapp', max_per_day: 3 };
const REM = { id: 'r1', tenant_id: 'T', policy_id: 'p1', task_id: 'tk1', lead_id: 'l1', scheduled_for: new Date('2026-11-12T10:00:00Z'), status: 'PENDING', sent_at: null, result: null };

describe('createPolicy / listPolicies', () => {
  it('valida name/kind; lista por tenant', async () => {
    const { client } = fakeClient((q) => (q.text.includes('INSERT INTO reminder_policies') ? [POL] : []));
    const p = await createPolicy(client, 'T', { name: 'due-60', kind: 'TASK_DUE' });
    expect(p.offsetMinutes).toBe(60); // defaults
    expect(p.maxPerDay).toBe(3);
    const { client: c2 } = fakeClient(() => []);
    await expect(createPolicy(c2, 'T', { name: '', kind: 'TASK_DUE' })).rejects.toThrow(ReminderRuleError);
    await expect(createPolicy(c2, 'T', { name: 'x', kind: 'OTHER' as 'TASK_DUE' })).rejects.toThrow(ReminderRuleError);
    const { client: c3 } = fakeClient(() => [POL]);
    const all = await listPolicies(c3, 'T');
    expect(all).toHaveLength(1);
  });
});

describe('updatePolicy', () => {
  it('404; maxPerDay inválido; patch enabled', async () => {
    const { client } = fakeClient(() => []);
    await expect(updatePolicy(client, 'T', 'zz', { enabled: false })).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient(() => [{ id: 'p1' }]);
    await expect(updatePolicy(c2, 'T', 'p1', { maxPerDay: 0 })).rejects.toThrow(ReminderRuleError);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ id: 'p1' }];
      return [{ ...POL, enabled: false }];
    });
    const p = await updatePolicy(c3, 'T', 'p1', { enabled: false });
    expect(p.enabled).toBe(false);
  });
});

describe('optOut (R2)', () => {
  it('404 lead; idempotente; status', async () => {
    const { client } = fakeClient(() => []);
    await expect(optOut(client, 'T', 'zz')).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1' }];
      return [];
    });
    const r = await optOut(c2, 'T', 'l1');
    expect(r.optedOut).toBe(true);
    const { client: c3 } = fakeClient(() => []);
    expect(await optOutStatus(c3, 'T', 'l1')).toEqual({ leadId: 'l1', optedOut: false, optedOutAt: null });
    const { client: c4 } = fakeClient(() => [{ opted_out_at: new Date('2026-11-11T10:00:00Z') }]);
    const st = await optOutStatus(c4, 'T', 'l1');
    expect(st.optedOut).toBe(true);
    expect(st.optedOutAt).toBe('2026-11-11T10:00:00.000Z');
  });
});

describe('generateReminders (R1/R3)', () => {
  const consentOk = (q: Q) => {
    if (q.text.includes('FROM reminder_policies')) return [POL];
    if (q.text.includes('FROM crm_tasks t')) return [{ id: 'tk1', lead_id: 'l1', due_at: new Date('2026-11-12T10:00:00Z') }];
    if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: null }];
    if (q.text.includes('INSERT INTO reminders') && q.text.includes("'PENDING'")) return [REM];
    return [];
  };
  it('policy off → skip sem gerar; FOLLOWUP ignorado no MVP', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM reminder_policies')) return [{ ...POL, enabled: false }];
      return [];
    });
    const r = await generateReminders(client, 'T');
    expect(r.created).toHaveLength(0);
    expect(r.skipped).toBe(1);
    const { client: c2 } = fakeClient(() => [{ ...POL, kind: 'FOLLOWUP' }]);
    const r2 = await generateReminders(c2, 'T');
    expect(r2.created).toHaveLength(0);
  });
  it('consent ok → cria PENDING; sem consent → SKIPPED; opt-out → SKIPPED', async () => {
    const { client } = fakeClient(consentOk);
    const r = await generateReminders(client, 'T');
    expect(r.created).toHaveLength(1);
    expect(r.created[0]!.status).toBe('PENDING');
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM crm_tasks t')) return [{ id: 'tk1', lead_id: 'l1', due_at: new Date('2026-11-12T10:00:00Z') }];
      if (q.text.includes('FROM reminder_policies')) return [POL];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: false, optout: null }];
      if (q.text.includes('INSERT INTO reminders')) return [{ ...REM, status: 'SKIPPED', result: 'no-consent' }];
      return [];
    });
    const r2 = await generateReminders(c2, 'T');
    expect(r2.skipped).toBe(1);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM crm_tasks t')) return [{ id: 'tk1', lead_id: 'l1', due_at: new Date('2026-11-12T10:00:00Z') }];
      if (q.text.includes('FROM reminder_policies')) return [POL];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: new Date() }];
      if (q.text.includes('INSERT INTO reminders')) return [{ ...REM, status: 'SKIPPED', result: 'opt-out' }];
      return [];
    });
    const r3 = await generateReminders(c3, 'T');
    expect(r3.skipped).toBe(1);
    // conflito UNIQUE → sem created nem skipped extra
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM reminder_policies')) return [POL];
      if (q.text.includes('FROM crm_tasks t')) return [];
      return [];
    });
    const r4 = await generateReminders(c4, 'T');
    expect(r4.created).toHaveLength(0);
  });
});

describe('dispatchReminders (R4/R5)', () => {
  const pending = [{ ...REM, policy_enabled: true, max_per_day: 3 }];
  const base = (over: Partial<typeof REM> = {}, pol = { policy_enabled: true, max_per_day: 3 }) => (q: Q) => {
    if (q.text.includes('FROM reminders r JOIN reminder_policies')) return [{ ...pending[0], ...over, ...pol }];
    if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: null }];
    if (q.text.includes("status = 'SENT' AND sent_at >= CURRENT_DATE")) return [{ n: 0 }];
    if (q.text.includes("SET status = 'SENT'")) return [{ ...REM, status: 'SENT', sent_at: new Date(), result: 'sent' }];
    if (q.text.includes("SET status = 'SKIPPED'")) return [{ ...REM, status: 'SKIPPED', result: q.values[2] as string }];
    return [];
  };
  it('envia PENDING com consent; no-consent/opt-out/policy-off/daily-limit → SKIPPED com motivo', async () => {
    const { client } = fakeClient(base());
    const r = await dispatchReminders(client, 'T');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.result).toBe('sent');
    // no-consent
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM reminders r JOIN reminder_policies')) return [{ ...pending[0] }];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: false, optout: null }];
      if (q.text.includes("status = 'SENT' AND sent_at >= CURRENT_DATE")) return [{ n: 0 }];
      if (q.text.includes("SET status = 'SKIPPED'")) return [{ ...REM, status: 'SKIPPED', result: q.values[2] as string }];
      return [];
    });
    const r2 = await dispatchReminders(c2, 'T');
    expect(r2.skipped[0]!.result).toBe('no-consent');
    // opt-out
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM reminders r JOIN reminder_policies')) return [{ ...pending[0] }];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: new Date() }];
      if (q.text.includes("status = 'SENT' AND sent_at >= CURRENT_DATE")) return [{ n: 0 }];
      if (q.text.includes("SET status = 'SKIPPED'")) return [{ ...REM, status: 'SKIPPED', result: q.values[2] as string }];
      return [];
    });
    const r3 = await dispatchReminders(c3, 'T');
    expect(r3.skipped[0]!.result).toBe('opt-out');
    // policy off
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM reminders r JOIN reminder_policies')) return [{ ...pending[0], policy_enabled: false, max_per_day: 3 }];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: null }];
      if (q.text.includes("status = 'SENT' AND sent_at >= CURRENT_DATE")) return [{ n: 0 }];
      if (q.text.includes("SET status = 'SKIPPED'")) return [{ ...REM, status: 'SKIPPED', result: q.values[2] as string }];
      return [];
    });
    const r4 = await dispatchReminders(c4, 'T');
    expect(r4.skipped[0]!.result).toBe('policy-off');
    // daily limit (1 já enviado hoje, max 1)
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('FROM reminders r JOIN reminder_policies')) return [{ ...pending[0], max_per_day: 1 }];
      if (q.text.includes('FROM leads l WHERE l.id')) return [{ consent: true, optout: null }];
      if (q.text.includes("status = 'SENT' AND sent_at >= CURRENT_DATE")) return [{ n: 1 }];
      if (q.text.includes("SET status = 'SKIPPED'")) return [{ ...REM, status: 'SKIPPED', result: q.values[2] as string }];
      return [];
    });
    const r5 = await dispatchReminders(c5, 'T');
    expect(r5.skipped[0]!.result).toBe('daily-limit');
  });
});

describe('branches finais reminders', () => {
  it('paths: updatePolicy offset/max, iso string optout, generate com policyId, due string, lead-missing', async () => {
    // updatePolicy com offset + maxPerDay (COALESCE paths)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ id: 'p1' }];
      return [{ ...POL, offset_minutes: 30, max_per_day: 5 }];
    });
    const p = await updatePolicy(c1, 'T', 'p1', { offsetMinutes: 30, maxPerDay: 5 });
    expect(p.offsetMinutes).toBe(30);
    expect(p.maxPerDay).toBe(5);
    // optOutStatus com string date
    const { client: c2 } = fakeClient(() => [{ opted_out_at: '2026-11-11T10:00:00.000Z' }]);
    const st = await optOutStatus(c2, 'T', 'l1');
    expect(st.optedOutAt).toBe('2026-11-11T10:00:00.000Z');
    // generate com policyId específico (branch query por id)
    const { client: c3, queries: q3 } = fakeClient((q) => {
      if (q.text.includes('FROM reminder_policies')) return [POL];
      if (q.text.includes('FROM crm_tasks t')) return [];
      return [];
    });
    const r3 = await generateReminders(c3, 'T', 'p1');
    expect(r3.created).toHaveLength(0);
    const pol = q3.find((q) => q.text.includes('FROM reminder_policies'))!;
    expect(pol.values[0]).toBe('p1');
    // lead-missing (gate sem lead) + due_at string
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM reminder_policies')) return [POL];
      if (q.text.includes('FROM crm_tasks t')) return [{ id: 'tk2', lead_id: 'ghost', due_at: '2026-11-12T10:00:00.000Z' }];
      if (q.text.includes('FROM leads l WHERE l.id')) return [];
      if (q.text.includes('INSERT INTO reminders')) return [{ ...REM, id: 'r2', task_id: 'tk2', status: 'SKIPPED', result: 'lead-missing' }];
      return [];
    });
    const r4 = await generateReminders(c4, 'T');
    expect(r4.skipped).toBe(1);
    const sk = c4.queries.find((q) => q.text.includes("'SKIPPED'"))!;
    expect(sk.values[6]).toBe('lead-missing');
  });
});

describe('listReminders / mapReminderError', () => {
  it('filtros e mapeamento', async () => {
    const { client, queries } = fakeClient(() => [{ ...REM, scheduled_for: '2026-11-12T10:00:00.000Z', sent_at: new Date('2026-11-12T11:00:00Z') }]);
    const all = await listReminders(client, 'T', {});
    expect(all[0]!.sentAt).toBe('2026-11-12T11:00:00.000Z'); // Date path
    expect(all[0]!.scheduledFor).toBe('2026-11-12T10:00:00.000Z'); // string path
    await listReminders(client, 'T', {});
    expect(queries[1]!.text).not.toContain('r.status = $2');
    await listReminders(client, 'T', { status: 'SENT', policyId: 'p1' });
    expect(queries[2]!.values).toEqual(['T', 'SENT', 'p1']);
    expect(mapReminderError(new ReminderRuleError('x')).status).toBe(422);
    expect(mapReminderError(new NotFoundError('x')).status).toBe(404);
    expect(mapReminderError(new Error('x')).status).toBe(500);
  });
});
