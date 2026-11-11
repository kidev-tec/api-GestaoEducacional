/**
 * E06-08 — Lembretes/follow-up sob opt-in (R1 consent+optout+enabled, R2 opt-out definitivo,
 * R3 geração idempotente, R4 limite diário, R5 dispatch com result, R6 supervisão, R7 tenant).
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class ReminderRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapReminderError(e: unknown): { status: number } {
  if (e instanceof ReminderRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

export type Policy = {
  id: string; tenantId: string; name: string; enabled: boolean;
  kind: 'TASK_DUE' | 'FOLLOWUP'; offsetMinutes: number; channel: 'inapp' | 'email'; maxPerDay: number;
};

type PolicyRow = Record<string, unknown> & { id: string; tenant_id: string; name: string; enabled: boolean; kind: Policy['kind']; offset_minutes: number; channel: Policy['channel']; max_per_day: number };

function toPolicy(r: PolicyRow): Policy {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, enabled: r.enabled, kind: r.kind,
    offsetMinutes: r.offset_minutes, channel: r.channel, maxPerDay: r.max_per_day,
  };
}

export async function createPolicy(c: Pg, tenantId: string, input: {
  name: string; kind: Policy['kind']; offsetMinutes?: number; channel?: Policy['channel']; maxPerDay?: number;
}): Promise<Policy> {
  if (!input.name?.trim()) throw new ReminderRuleError('name required');
  if (input.kind !== 'TASK_DUE' && input.kind !== 'FOLLOWUP') throw new ReminderRuleError('kind inválido');
  const r = await c.query(
    `INSERT INTO reminder_policies (id, tenant_id, name, kind, offset_minutes, channel, max_per_day)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tenant_id, name, enabled, kind, offset_minutes, channel, max_per_day`,
    [randomUUID(), tenantId, input.name, input.kind, input.offsetMinutes ?? 60, input.channel ?? 'inapp', input.maxPerDay ?? 3],
  );
  return toPolicy(r.rows[0] as PolicyRow);
}

export async function updatePolicy(c: PoolClient, tenantId: string, policyId: string, patch: {
  enabled?: boolean; offsetMinutes?: number; maxPerDay?: number;
}): Promise<Policy> {
  const cur = await c.query('SELECT id FROM reminder_policies WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [policyId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('policy não encontrada');
  if (patch.maxPerDay != null && patch.maxPerDay <= 0) throw new ReminderRuleError('max_per_day deve ser > 0');
  const r = await c.query(
    `UPDATE reminder_policies SET
       enabled = COALESCE($3, enabled),
       offset_minutes = COALESCE($4, offset_minutes),
       max_per_day = COALESCE($5, max_per_day),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, name, enabled, kind, offset_minutes, channel, max_per_day`,
    [policyId, tenantId, patch.enabled ?? null, patch.offsetMinutes ?? null, patch.maxPerDay ?? null],
  );
  return toPolicy(r.rows[0] as PolicyRow);
}

export async function listPolicies(c: Pg, tenantId: string): Promise<Policy[]> {
  const r = await c.query(
    'SELECT id, tenant_id, name, enabled, kind, offset_minutes, channel, max_per_day FROM reminder_policies WHERE tenant_id = $1 ORDER BY created_at',
    [tenantId],
  );
  return (r.rows as PolicyRow[]).map(toPolicy);
}

/** R2: opt-out definitivo por lead (idempotente). */
export async function optOut(c: PoolClient, tenantId: string, leadId: string): Promise<{ leadId: string; optedOut: true }> {
  const lead = await c.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2', [leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  await c.query(
    'INSERT INTO reminder_optouts (tenant_id, lead_id) VALUES ($1,$2) ON CONFLICT (tenant_id, lead_id) DO NOTHING',
    [tenantId, leadId],
  );
  return { leadId, optedOut: true };
}

export async function optOutStatus(c: Pg, tenantId: string, leadId: string): Promise<{ leadId: string; optedOut: boolean; optedOutAt: string | null }> {
  const r = await c.query(
    'SELECT opted_out_at FROM reminder_optouts WHERE tenant_id = $1 AND lead_id = $2',
    [tenantId, leadId],
  );
  if (!r.rowCount) return { leadId, optedOut: false, optedOutAt: null };
  const at = (r.rows[0] as { opted_out_at: Date | string }).opted_out_at;
  return { leadId, optedOut: true, optedOutAt: at instanceof Date ? at.toISOString() : new Date(at).toISOString() };
}

export type Reminder = {
  id: string; tenantId: string; policyId: string; taskId: string | null; leadId: string;
  scheduledFor: string; status: 'PENDING' | 'SENT' | 'SKIPPED' | 'CANCELLED'; sentAt: string | null; result: string | null;
};

type ReminderRow = Record<string, unknown> & {
  id: string; tenant_id: string; policy_id: string; task_id: string | null; lead_id: string;
  scheduled_for: Date | string; status: Reminder['status']; sent_at: Date | string | null; result: string | null;
};

function toReminder(r: ReminderRow): Reminder {
  const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  return {
    id: r.id, tenantId: r.tenant_id, policyId: r.policy_id, taskId: r.task_id, leadId: r.lead_id,
    scheduledFor: iso(r.scheduled_for) as string, status: r.status, sentAt: iso(r.sent_at), result: r.result,
  };
}

/** R1–R3: geração idempotente de lembretes para tasks abertas na janela da policy. */
export async function generateReminders(c: PoolClient, tenantId: string, policyId?: string): Promise<{ created: Reminder[]; skipped: number }> {
  const policies = policyId
    ? await c.query('SELECT * FROM reminder_policies WHERE id = $1 AND tenant_id = $2', [policyId, tenantId])
    : await c.query('SELECT * FROM reminder_policies WHERE tenant_id = $1 AND enabled = true', [tenantId]);
  const created: Reminder[] = [];
  let skipped = 0;
  for (const pRaw of policies.rows as PolicyRow[]) {
    const policy = toPolicy(pRaw);
    if (!policy.enabled) { skipped += 1; continue; } // policy off → nada gerado
    if (policy.kind !== 'TASK_DUE') continue; // FOLLOWUP MVP: geração manual futura
    const tasks = await c.query(
      `SELECT t.id, t.lead_id, t.due_at FROM crm_tasks t
       WHERE t.tenant_id = $1 AND t.status = 'open'
         AND t.due_at BETWEEN now() AND now() + make_interval(mins => $2)
         AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.tenant_id = $1 AND r.policy_id = $3 AND r.task_id = t.id)`,
      [tenantId, policy.offsetMinutes, policy.id],
    );
    for (const tRaw of tasks.rows as Array<{ id: string; lead_id: string; due_at: Date | string }>) {
      // R1: consent + opt-out
      const gate = await c.query(
        `SELECT l.consent, (SELECT opted_out_at FROM reminder_optouts o WHERE o.tenant_id = l.tenant_id AND o.lead_id = l.id) AS optout
         FROM leads l WHERE l.id = $1 AND l.tenant_id = $2`,
        [tRaw.lead_id, tenantId],
      );
      const g = gate.rows[0] as { consent: boolean; optout: Date | string | null } | undefined;
      const dueIso = tRaw.due_at instanceof Date ? tRaw.due_at.toISOString() : new Date(tRaw.due_at).toISOString();
      if (!g || !g.consent || g.optout != null) {
        // registra SKIPPED auditável (idempotente pela UNIQUE)
        const sk = await c.query(
          `INSERT INTO reminders (id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status, result)
           VALUES ($1,$2,$3,$4,$5,$6,'SKIPPED',$7)
           ON CONFLICT (tenant_id, policy_id, task_id) DO NOTHING
           RETURNING id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status, sent_at, result`,
          [randomUUID(), tenantId, policy.id, tRaw.id, tRaw.lead_id, dueIso, !g ? 'lead-missing' : (!g.consent ? 'no-consent' : 'opt-out')],
        );
        if (sk.rowCount) skipped += 1;
        continue;
      }
      const ins = await c.query(
        `INSERT INTO reminders (id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
         ON CONFLICT (tenant_id, policy_id, task_id) DO NOTHING
         RETURNING id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status, sent_at, result`,
        [randomUUID(), tenantId, policy.id, tRaw.id, tRaw.lead_id, dueIso],
      );
      if (ins.rowCount) created.push(toReminder(ins.rows[0] as ReminderRow));
    }
  }
  return { created, skipped };
}

/** R4–R5: dispatch de PENDING respeitando consent/opt-out/policy-enabled e limite diário. */
export async function dispatchReminders(c: PoolClient, tenantId: string): Promise<{ sent: Reminder[]; skipped: Reminder[] }> {
  const pending = await c.query(
    `SELECT r.*, p.enabled AS policy_enabled, p.max_per_day
     FROM reminders r JOIN reminder_policies p ON p.id = r.policy_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.status = 'PENDING'
     ORDER BY r.scheduled_for ASC FOR UPDATE OF r`,
    [tenantId],
  );
  const sent: Reminder[] = [];
  const skipped: Reminder[] = [];
  const sentToday = new Map<string, number>();
  for (const raw of pending.rows as Array<ReminderRow & { policy_enabled: boolean; max_per_day: number }>) {
    // R1: revalida consent/opt-out no dispatch (pode ter mudado desde a geração)
    const gate = await c.query(
      `SELECT l.consent, (SELECT opted_out_at FROM reminder_optouts o WHERE o.tenant_id = l.tenant_id AND o.lead_id = l.id) AS optout
       FROM leads l WHERE l.id = $1 AND l.tenant_id = $2`,
      [raw.lead_id, tenantId],
    );
    const g = gate.rows[0] as { consent: boolean; optout: Date | string | null } | undefined;
    const key = `${raw.policy_id}:${new Date().toISOString().slice(0, 10)}`;
    let todayCount = sentToday.get(key);
    if (todayCount == null) {
      const cnt = await c.query(
        `SELECT COUNT(*)::int AS n FROM reminders WHERE tenant_id = $1 AND policy_id = $2 AND status = 'SENT' AND sent_at >= CURRENT_DATE`,
        [tenantId, raw.policy_id],
      );
      todayCount = Number((cnt.rows[0] as { n: number }).n);
      sentToday.set(key, todayCount);
    }
    let skipReason: string | null = null;
    if (!raw.policy_enabled) skipReason = 'policy-off';
    else if (!g || !g.consent) skipReason = 'no-consent';
    else if (g.optout != null) skipReason = 'opt-out';
    else if (todayCount >= raw.max_per_day) skipReason = 'daily-limit';
    if (skipReason) {
      const up = await c.query(
        `UPDATE reminders SET status = 'SKIPPED', result = $3 WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
         RETURNING id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status, sent_at, result`,
        [raw.id, tenantId, skipReason],
      );
      if (up.rowCount) skipped.push(toReminder(up.rows[0] as ReminderRow));
      continue;
    }
    const ok = await c.query(
      `UPDATE reminders SET status = 'SENT', sent_at = now(), result = 'sent' WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
       RETURNING id, tenant_id, policy_id, task_id, lead_id, scheduled_for, status, sent_at, result`,
      [raw.id, tenantId],
    );
    if (ok.rowCount) {
      const rem = toReminder(ok.rows[0] as ReminderRow);
      sent.push(rem);
      sentToday.set(key, todayCount + 1);
    }
  }
  return { sent, skipped };
}

/** R6: supervisão. */
export async function listReminders(c: Pg, tenantId: string, filter: { status?: string; policyId?: string }): Promise<Reminder[]> {
  const conds = ['r.tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.status) { vals.push(filter.status); conds.push(`r.status = $${vals.length}`); }
  if (filter.policyId) { vals.push(filter.policyId); conds.push(`r.policy_id = $${vals.length}`); }
  const r = await c.query(
    `SELECT r.id, r.tenant_id, r.policy_id, r.task_id, r.lead_id, r.scheduled_for, r.status, r.sent_at, r.result
     FROM reminders r WHERE ${conds.join(' AND ')} ORDER BY r.scheduled_for DESC LIMIT 200`,
    vals,
  );
  return (r.rows as ReminderRow[]).map(toReminder);
}
