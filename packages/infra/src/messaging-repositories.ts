/**
 * E09-03 — mensageria omnichannel: providers, fila com opt-out,
 * adapters sandbox/live atrás de contrato uniforme, updates de webhook.
 */
export class MessagingError extends Error {
  override name = 'MessagingError';
}

export type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS';
const CHANNELS: readonly Channel[] = ['WHATSAPP', 'EMAIL', 'SMS'];
const STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'OPT_OUT'] as const;
export type DeliveryStatus = (typeof STATUSES)[number];

type Pg = { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number }> };

export type ProviderConfig = { mode?: string; [k: string]: unknown };
export type MessagingProvider = {
  id: string; tenantId: string; channel: Channel; providerName: string;
  config: ProviderConfig; active: boolean;
};

export type MessageDelivery = {
  id: string; tenantId: string; channel: Channel; templateId: string | null;
  recipient: string; payload: Record<string, unknown>; status: DeliveryStatus;
  providerMessageId: string | null; attempts: number; lastError: string | null;
};

const MASK_KEYS = /token|secret|password|api[-_]?key|dsn/i;
function maskConfig(cfg: ProviderConfig): ProviderConfig {
  const out: ProviderConfig = {};
  for (const [k, v] of Object.entries(cfg)) out[k] = MASK_KEYS.test(k) ? '***' : v;
  return out;
}

export function assertChannel(c: string): asserts c is Channel {
  if (!(CHANNELS as readonly string[]).includes(c)) throw new MessagingError(`canal inválido: ${c}`);
}

export async function upsertProvider(db: Pg, tenantId: string, input: {
  channel: string; providerName: string; config: ProviderConfig; active?: boolean;
}): Promise<MessagingProvider> {
  assertChannel(input.channel);
  const r = (
    await db.query(
      `INSERT INTO messaging_providers (tenant_id, channel, provider_name, config, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET provider_name = EXCLUDED.provider_name, config = EXCLUDED.config, active = EXCLUDED.active
       RETURNING *`,
      [tenantId, input.channel, input.providerName, JSON.stringify(input.config), input.active ?? true],
    )
  ).rows[0];
  return toProvider(r);
}

function toProvider(r: any): MessagingProvider {
  return {
    id: r.id, tenantId: r.tenant_id, channel: r.channel, providerName: r.provider_name,
    config: maskConfig(r.config ?? {}), active: r.active,
  };
}

export async function enqueueMessage(db: Pg, tenantId: string, input: {
  channel: string; recipient: string; templateId?: string | null; payload?: Record<string, unknown>;
}): Promise<MessageDelivery> {
  assertChannel(input.channel);
  const optedOut = (await db.query('SELECT 1 FROM opt_outs WHERE tenant_id = $1 AND channel = $2 AND recipient = $3', [tenantId, input.channel, input.recipient])).rows.length > 0;
  const status: DeliveryStatus = optedOut ? 'OPT_OUT' : 'QUEUED';
  const r = (
    await db.query(
      `INSERT INTO message_deliveries (tenant_id, channel, template_id, recipient, payload, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, input.channel, input.templateId ?? null, input.recipient, JSON.stringify(input.payload ?? {}), status],
    )
  ).rows[0];
  return toDelivery(r);
}

function toDelivery(r: any): MessageDelivery {
  return {
    id: r.id, tenantId: r.tenant_id, channel: r.channel, templateId: r.template_id ?? null,
    recipient: r.recipient, payload: r.payload ?? {}, status: r.status,
    providerMessageId: r.provider_message_id ?? null, attempts: r.attempts ?? 0,
    lastError: r.last_error ?? null,
  };
}

export type DeliveryAdapter = {
  mode: 'sandbox' | 'live';
  send(msg: { id: string; channel: Channel; recipient: string; payload: Record<string, unknown> }): Promise<{ ok: boolean; providerMessageId: string; error?: string }>;
};

export function createSandboxAdapter(): DeliveryAdapter {
  return {
    mode: 'sandbox',
    async send(msg) {
      return { ok: true, providerMessageId: `sbx-${msg.id}` };
    },
  };
}

export async function drainQueue(db: Pg, adapter: DeliveryAdapter, limit: number): Promise<number> {
  const rows = (await db.query(`SELECT * FROM message_deliveries WHERE status = 'QUEUED' ORDER BY created_at LIMIT $1`, [limit])).rows;
  let n = 0;
  for (const row of rows) {
    const msg = toDelivery(row);
    let res: Awaited<ReturnType<DeliveryAdapter['send']>>;
    try {
      res = await adapter.send({ id: msg.id, channel: msg.channel, recipient: msg.recipient, payload: msg.payload });
    } catch (e) {
      res = { ok: false, providerMessageId: '', error: e instanceof Error ? e.message : String(e) };
    }
    const attempts = msg.attempts + 1;
    const failed = !res.ok;
    const final = failed && attempts >= 3 ? 'FAILED' : failed ? 'QUEUED' : 'SENT';
    await db.query(
      `UPDATE message_deliveries SET status = $1, provider_message_id = $2, attempts = $3, last_error = $4, updated_at = now() WHERE id = $5`,
      [final, res.ok ? res.providerMessageId : msg.providerMessageId, attempts, res.error ?? msg.lastError, msg.id],
    );
    if (!failed) n += 1;
  }
  return n;
}

export async function recordDeliveryUpdate(db: Pg, input: { providerMessageId: string; status: DeliveryStatus }): Promise<MessageDelivery> {
  const existing = (await db.query(`SELECT * FROM message_deliveries WHERE provider_message_id = $1`, [input.providerMessageId])).rows[0];
  if (!existing) throw new MessagingError(`mensagem desconhecida: ${input.providerMessageId}`);
  if (existing.status === input.status) return toDelivery(existing); // idempotente
  const r = (await db.query(`UPDATE message_deliveries SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`, [input.status, existing.id])).rows[0];
  return toDelivery(r);
}

export async function optOut(db: Pg, tenantId: string, input: { channel: string; recipient: string }): Promise<void> {
  assertChannel(input.channel);
  await db.query(`INSERT INTO opt_outs (tenant_id, channel, recipient) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, input.channel, input.recipient]);
}

export async function listDeliveries(db: Pg, tenantId: string, filter: { status?: DeliveryStatus; limit?: number }): Promise<MessageDelivery[]> {
  const status = filter.status ?? null;
  const rows = (
    await db.query(
      `SELECT * FROM message_deliveries WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT $3`,
      [tenantId, status, filter.limit ?? 50],
    )
  ).rows;
  return rows.map(toDelivery);
}
