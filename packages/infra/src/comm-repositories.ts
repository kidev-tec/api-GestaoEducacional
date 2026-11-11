/**
 * E09-01 — matriz de eventos de comunicação e fila local.
 * Sem envio externo: inapp/email são registro (R1-R5 da SPEC).
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class CommRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapCommError(e: unknown): { status: number } {
  if (e instanceof CommRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

export type EventDef = {
  id: string; tenantId: string; eventKey: string; channel: 'inapp' | 'email';
  name: string; templateSubject: string; templateBody: string; enabled: boolean;
};
type DefRow = Record<string, unknown> & {
  id: string; tenant_id: string; event_key: string; channel: EventDef['channel'];
  name: string; template_subject: string; template_body: string; enabled: boolean;
};
const toDef = (r: DefRow): EventDef => ({
  id: r.id, tenantId: r.tenant_id, eventKey: r.event_key, channel: r.channel,
  name: r.name, templateSubject: r.template_subject, templateBody: r.template_body, enabled: r.enabled,
});

export async function upsertEventDef(c: Pg, tenantId: string, input: {
  eventKey: string; channel: EventDef['channel']; name: string; templateBody: string; templateSubject?: string;
}): Promise<EventDef> {
  if (!/^[a-z0-9._-]+$/.test(input.eventKey)) throw new CommRuleError('event_key deve ser slug (a-z0-9._-)');
  if (!input.templateBody?.trim()) throw new CommRuleError('template_body é obrigatório');
  const r = await c.query(
    `INSERT INTO comm_event_defs (id, tenant_id, event_key, channel, name, template_subject, template_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, event_key, channel) DO UPDATE
       SET name = EXCLUDED.name, template_subject = EXCLUDED.template_subject, template_body = EXCLUDED.template_body, updated_at = now()
     RETURNING id, tenant_id, event_key, channel, name, template_subject, template_body, enabled`,
    [randomUUID(), tenantId, input.eventKey, input.channel, input.name, input.templateSubject ?? '', input.templateBody],
  );
  return toDef(r.rows[0] as DefRow);
}

export async function listEventDefs(c: Pg, tenantId: string): Promise<EventDef[]> {
  const r = await c.query(
    'SELECT id, tenant_id, event_key, channel, name, template_subject, template_body, enabled FROM comm_event_defs WHERE tenant_id = $1 ORDER BY created_at',
    [tenantId],
  );
  return (r.rows as DefRow[]).map(toDef);
}

export async function updateEventDef(c: Pg, tenantId: string, defId: string, patch: {
  enabled?: boolean; templateSubject?: string; templateBody?: string;
}): Promise<EventDef> {
  const cur = await c.query('SELECT id FROM comm_event_defs WHERE id = $1 AND tenant_id = $2', [defId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('definição não encontrada');
  if (patch.templateBody != null && !patch.templateBody.trim()) throw new CommRuleError('template_body é obrigatório');
  const r = await c.query(
    `UPDATE comm_event_defs SET
       enabled = COALESCE($3, enabled),
       template_subject = COALESCE($4, template_subject),
       template_body = COALESCE($5, template_body),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, event_key, channel, name, template_subject, template_body, enabled`,
    [defId, tenantId, patch.enabled ?? null, patch.templateSubject ?? null, patch.templateBody ?? null],
  );
  return toDef(r.rows[0] as DefRow);
}

export type CommMessage = {
  id: string; tenantId: string; eventKey: string; channel: 'inapp' | 'email';
  recipientUserId: string | null; leadId: string | null; payload: unknown;
  status: 'QUEUED' | 'DELIVERED_LOCAL' | 'SKIPPED'; skipReason: string | null; deliveredAt: string | null;
};
type MsgRow = Record<string, unknown> & {
  id: string; tenant_id: string; event_key: string; channel: CommMessage['channel'];
  recipient_user_id: string | null; lead_id: string | null; payload: unknown;
  status: CommMessage['status']; skip_reason: string | null; delivered_at: Date | string | null;
};
const toMsg = (r: MsgRow): CommMessage => ({
  id: r.id, tenantId: r.tenant_id, eventKey: r.event_key, channel: r.channel,
  recipientUserId: r.recipient_user_id, leadId: r.lead_id, payload: r.payload,
  status: r.status, skipReason: r.skip_reason,
  deliveredAt: r.delivered_at == null ? null : r.delivered_at instanceof Date ? r.delivered_at.toISOString() : new Date(r.delivered_at).toISOString(),
});

/** R2/R4: enfileira mensagem; exige def enabled; lead com opt-out → SKIPPED. */
export async function enqueueMessage(c: PoolClient, tenantId: string, input: {
  eventKey: string; channel: EventDef['channel']; payload: unknown; recipientUserId?: string; leadId?: string;
}): Promise<CommMessage> {
  const def = await c.query(
    'SELECT id, enabled FROM comm_event_defs WHERE tenant_id = $1 AND event_key = $2 AND channel = $3',
    [tenantId, input.eventKey, input.channel],
  );
  if (!def.rowCount) throw new NotFoundError(`sem definição para ${input.eventKey}/${input.channel}`);
  if (!(def.rows[0] as { enabled: boolean }).enabled) throw new CommRuleError('definição de evento desabilitada');
  // R4: opt-out herdado de E06-08
  if (input.leadId) {
    const oo = await c.query(
      'SELECT opted_out_at FROM reminder_optouts WHERE tenant_id = $1 AND lead_id = $2',
      [tenantId, input.leadId],
    );
    if (oo.rowCount) {
      const ins = await c.query(
        `INSERT INTO comm_messages (id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload, status, skip_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'SKIPPED','opt-out')
         RETURNING id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload, status, skip_reason, delivered_at`,
        [randomUUID(), tenantId, input.eventKey, input.channel, input.recipientUserId ?? null, input.leadId, JSON.stringify(input.payload ?? {})],
      );
      return toMsg(ins.rows[0] as MsgRow);
    }
  }
  const r = await c.query(
    `INSERT INTO comm_messages (id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload, status, skip_reason, delivered_at`,
    [randomUUID(), tenantId, input.eventKey, input.channel, input.recipientUserId ?? null, input.leadId ?? null, JSON.stringify(input.payload ?? {})],
  );
  return toMsg(r.rows[0] as MsgRow);
}

/** R3: QUEUED→DELIVERED_LOCAL (grava delivered_at); replay idempotente; SKIPPED → 422. */
export async function deliverMessage(c: PoolClient, tenantId: string, messageId: string): Promise<CommMessage> {
  const cur = await c.query(
    'SELECT * FROM comm_messages WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [messageId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError('mensagem não encontrada');
  const msg = toMsg(cur.rows[0] as MsgRow);
  if (msg.status === 'DELIVERED_LOCAL') return msg; // idempotente
  if (msg.status === 'SKIPPED') throw new CommRuleError('mensagem marcada SKIPPED não pode ser entregue');
  const r = await c.query(
    `UPDATE comm_messages SET status = 'DELIVERED_LOCAL', delivered_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'QUEUED'
     RETURNING id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload, status, skip_reason, delivered_at`,
    [messageId, tenantId],
  );
  return toMsg(r.rows[0] as MsgRow);
}

export async function listMessages(c: Pg, tenantId: string, filter: { status?: string; eventKey?: string }): Promise<CommMessage[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.status) { vals.push(filter.status); conds.push(`status = $${vals.length}`); }
  if (filter.eventKey) { vals.push(filter.eventKey); conds.push(`event_key = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, event_key, channel, recipient_user_id, lead_id, payload, status, skip_reason, delivered_at
     FROM comm_messages WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    vals,
  );
  return (r.rows as MsgRow[]).map(toMsg);
}

export async function commStats(c: Pg, tenantId: string): Promise<Array<{ channel: string; status: string; n: number }>> {
  const r = await c.query(
    'SELECT channel, status, COUNT(*)::int AS n FROM comm_messages WHERE tenant_id = $1 GROUP BY channel, status',
    [tenantId],
  );
  return r.rows as Array<{ channel: string; status: string; n: number }>;
}

/** Sincronização manual: outbox pendente de eventos mapeados → comm_messages (um por def habilitado). */
export async function syncFromOutbox(c: PoolClient, tenantId: string): Promise<{ created: number }> {
  const pending = await c.query(
    "SELECT id, tenant_id, type AS event_type, payload FROM outbox_events WHERE tenant_id = $1 AND processed_at IS NULL",
    [tenantId],
  );
  let created = 0;
  for (const oeRaw of pending.rows as Array<{ id: string; tenant_id: string; event_type: string; payload: unknown }>) {
    const defs = await c.query(
      'SELECT id, enabled, channel FROM comm_event_defs WHERE tenant_id = $1 AND event_key = $2',
      [tenantId, oeRaw.event_type],
    );
    for (const dRaw of defs.rows as Array<{ id: string; enabled: boolean; channel: EventDef['channel'] }>) {
      if (!dRaw.enabled) continue;
      await enqueueMessage(c, tenantId, {
        eventKey: oeRaw.event_type, channel: dRaw.channel, payload: oeRaw.payload,
      });
      created += 1;
    }
    await c.query('UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1 AND tenant_id = $2', [oeRaw.id, tenantId]);
  }
  return { created };
}
