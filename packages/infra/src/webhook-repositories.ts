/**
 * E12-05 — webhooks de saída: assinatura HMAC, retries exponenciais, DLQ.
 * Entrega local nesta fase (adapter grava resultado; sem rede real).
 */
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class WebhookRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapWebhookError(e: unknown): { status: number } {
  if (e instanceof WebhookRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

const MAX_ATTEMPTS = 5;

/** R2: HMAC-SHA256 sobre `t + '.' + body`; formato `t=<ts>,v1=<hex>`. */
export function signWebhookPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): { signature: string; timestamp: number } {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { signature: `t=${timestamp},v1=${hex}`, timestamp };
}

/** Verificação (para receptor/testes): tolerância de ±5 min no timestamp. */
export function verifyWebhookSignature(secret: string, timestamp: number, body: string, signature: string, toleranceSeconds = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const m = /^t=\d+,v1=([a-f0-9]{64})$/.exec(signature);
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return m[1] === expected;
}

export type WebhookEndpoint = {
  id: string; tenantId: string; url: string; secret: string; events: string[]; enabled: boolean;
};
type EpRow = Record<string, unknown> & { id: string; tenant_id: string; url: string; secret: string; events: string[]; enabled: boolean };
const toEp = (r: EpRow): WebhookEndpoint => ({ id: r.id, tenantId: r.tenant_id, url: r.url, secret: r.secret, events: r.events, enabled: r.enabled });

export async function createEndpoint(c: Pg, tenantId: string, input: {
  url: string; secret?: string; events?: string[];
}): Promise<WebhookEndpoint> {
  const secret = input.secret ?? randomBytes(32).toString('hex');
  if (secret.length < 32) throw new WebhookRuleError('secret deve ter ao menos 32 caracteres');
  const r = await c.query(
    `INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, url) DO UPDATE SET secret = EXCLUDED.secret, events = EXCLUDED.events, updated_at = now()
     RETURNING id, tenant_id, url, secret, events, enabled`,
    [randomUUID(), tenantId, input.url, secret, input.events ?? ['*']],
  );
  return toEp(r.rows[0] as EpRow);
}

export async function listEndpoints(c: Pg, tenantId: string): Promise<WebhookEndpoint[]> {
  const r = await c.query('SELECT id, tenant_id, url, secret, events, enabled FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at', [tenantId]);
  return (r.rows as EpRow[]).map(toEp);
}

export async function updateEndpoint(c: Pg, tenantId: string, epId: string, patch: {
  enabled?: boolean; events?: string[]; url?: string;
}): Promise<WebhookEndpoint> {
  const cur = await c.query('SELECT id FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [epId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('endpoint não encontrado');
  const r = await c.query(
    `UPDATE webhook_endpoints SET
       enabled = COALESCE($3, enabled),
       events = COALESCE($4, events),
       url = COALESCE($5, url),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, url, secret, events, enabled`,
    [epId, tenantId, patch.enabled ?? null, patch.events ?? null, patch.url ?? null],
  );
  return toEp(r.rows[0] as EpRow);
}

export async function rotateSecret(c: Pg, tenantId: string, epId: string): Promise<WebhookEndpoint> {
  const cur = await c.query('SELECT id FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [epId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('endpoint não encontrado');
  const secret = randomBytes(32).toString('hex');
  const r = await c.query(
    'UPDATE webhook_endpoints SET secret = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, url, secret, events, enabled',
    [epId, tenantId, secret],
  );
  return toEp(r.rows[0] as EpRow);
}

export type Delivery = {
  id: string; tenantId: string; endpointId: string; outboxId: string | null; eventKey: string;
  payload: unknown; signature: string; status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number; responseCode: number | null;
};
type DlvRow = Record<string, unknown> & {
  id: string; tenant_id: string; endpoint_id: string; outbox_id: string | null; event_key: string;
  payload: unknown; signature: string; status: Delivery['status']; attempts: number;
  response_code: number | null;
};
const toDlv = (r: DlvRow): Delivery => ({
  id: r.id, tenantId: r.tenant_id, endpointId: r.endpoint_id, outboxId: r.outbox_id, eventKey: r.event_key,
  payload: r.payload, signature: r.signature, status: r.status, attempts: r.attempts, responseCode: r.response_code,
});

const matchesEvent = (ep: WebhookEndpoint, eventKey: string): boolean =>
  ep.events.includes('*') || ep.events.includes(eventKey);

/** R5: outbox pendente → deliveries PENDING para cada endpoint habilitado que casa o evento. */
export async function dispatchWebhooks(c: PoolClient, tenantId: string): Promise<{ created: number }> {
  const pending = await c.query(
    'SELECT id, tenant_id, type AS event_key, payload FROM outbox_events WHERE tenant_id = $1 AND processed_at IS NULL',
    [tenantId],
  );
  const eps = (await listEndpoints(c, tenantId)).filter((e) => e.enabled);
  let created = 0;
  for (const oeRaw of pending.rows as Array<{ id: string; tenant_id: string; event_key: string; payload: unknown }>) {
    for (const ep of eps) {
      if (!matchesEvent(ep, oeRaw.event_key)) continue;
      const body = JSON.stringify(oeRaw.payload ?? {});
      const { signature } = signWebhookPayload(ep.secret, body);
      await c.query(
        `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), tenantId, ep.id, oeRaw.id, oeRaw.event_key, body, signature],
      );
      created += 1;
    }
    await c.query('UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1 AND tenant_id = $2', [oeRaw.id, tenantId]);
  }
  return { created };
}

/**
 * R3: processa uma delivery com adapter local (grava resultado).
 * DELIVERED com 200; falha simulada quando attempts ≥ MAX-1 → FAILED/DLQ;
 * caso contrário PENDING com backoff exponencial 2^attempts min (cap 60).
 */
export async function processDelivery(c: PoolClient, tenantId: string, deliveryId: string, opts?: { failLocal?: boolean }): Promise<Delivery> {
  const cur = await c.query(
    'SELECT * FROM webhook_deliveries WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [deliveryId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError('delivery não encontrada');
  const dlv = toDlv(cur.rows[0] as DlvRow);
  if (dlv.status === 'DELIVERED') return dlv; // idempotente
  if (dlv.status === 'FAILED') throw new WebhookRuleError('delivery em DLQ — use replay');
  const attempts = dlv.attempts + 1;
  // Adapter local: entrega com sucesso salvo simulação de falha (sem rede nesta fase).
  const failed = opts?.failLocal === true || attempts >= MAX_ATTEMPTS;
  if (failed && attempts >= MAX_ATTEMPTS) {
    const r = await c.query(
      `UPDATE webhook_deliveries SET status = 'FAILED', attempts = $3, response_code = 500, last_attempt_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code`,
      [deliveryId, tenantId, attempts],
    );
    return toDlv(r.rows[0] as DlvRow);
  }
  if (failed) {
    const backoffMin = Math.min(2 ** attempts, 60);
    const r = await c.query(
      `UPDATE webhook_deliveries SET attempts = $3, response_code = 500, last_attempt_at = now(),
         next_attempt_at = now() + make_interval(mins => $4)
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code`,
      [deliveryId, tenantId, attempts, backoffMin],
    );
    return toDlv(r.rows[0] as DlvRow);
  }
  const r = await c.query(
    `UPDATE webhook_deliveries SET status = 'DELIVERED', attempts = $3, response_code = 200, last_attempt_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code`,
    [deliveryId, tenantId, attempts],
  );
  return toDlv(r.rows[0] as DlvRow);
}

export async function listDeliveries(c: Pg, tenantId: string, filter: { status?: string; endpointId?: string }): Promise<Delivery[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.status) { vals.push(filter.status); conds.push(`status = $${vals.length}`); }
  if (filter.endpointId) { vals.push(filter.endpointId); conds.push(`endpoint_id = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code
     FROM webhook_deliveries WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    vals,
  );
  return (r.rows as DlvRow[]).map(toDlv);
}

export async function listDlq(c: Pg, tenantId: string): Promise<Delivery[]> {
  const r = await c.query(
    `SELECT id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code
     FROM webhook_deliveries WHERE tenant_id = $1 AND status = 'FAILED' ORDER BY created_at DESC LIMIT 200`,
    [tenantId],
  );
  return (r.rows as DlvRow[]).map(toDlv);
}

export async function replayDlq(c: Pg, tenantId: string, deliveryId: string): Promise<Delivery> {
  const cur = await c.query('SELECT status FROM webhook_deliveries WHERE id = $1 AND tenant_id = $2', [deliveryId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('delivery não encontrada');
  if ((cur.rows[0] as { status: string }).status !== 'FAILED') throw new WebhookRuleError('apenas deliveries em DLQ podem ser replays');
  const r = await c.query(
    `UPDATE webhook_deliveries SET status = 'PENDING', attempts = 0, response_code = NULL, next_attempt_at = NULL
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, endpoint_id, outbox_id, event_key, payload, signature, status, attempts, response_code`,
    [deliveryId, tenantId],
  );
  return toDlv(r.rows[0] as DlvRow);
}
