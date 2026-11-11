/**
 * E12-05 — webhooks de saída: assinatura HMAC, retries, DLQ (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  WebhookRuleError, createEndpoint, listEndpoints, updateEndpoint, rotateSecret,
  dispatchWebhooks, processDelivery, listDeliveries, listDlq, replayDlq,
  signWebhookPayload, verifyWebhookSignature, mapWebhookError,
} from '../src/webhook-repositories.js';
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

const SECRET = 'k'.repeat(40);
const EP = { id: 'e1', tenant_id: 'T', url: 'https://x.example/hook', secret: SECRET, events: ['*'], enabled: true };
const DLV = { id: 'w1', tenant_id: 'T', endpoint_id: 'e1', outbox_id: null, event_key: 'enrollment.created', payload: '{}', signature: 'sig', status: 'PENDING', attempts: 0, response_code: null, last_attempt_at: null, next_attempt_at: null };

describe('endpoints', () => {
  it('secret <32 → 422; auto-gera se ausente; lista; update; rotate; 404', async () => {
    const { client, queries } = fakeClient((q) => (q.text.includes('INSERT INTO webhook_endpoints') ? [EP] : []));
    const e = await createEndpoint(client, 'T', { url: 'https://x.example/hook', events: ['*'] });
    expect(e.secret).toBe(SECRET); // retorno do fake
    const inserted = String(queries[0]!.values[3]);
    expect(inserted.length).toBeGreaterThanOrEqual(32); // auto-gerado
    // com secret explícito
    const { client: cx, queries: qx } = fakeClient((q) => (q.text.includes('INSERT INTO webhook_endpoints') ? [EP] : []));
    await createEndpoint(cx, 'T', { url: 'u2', secret: SECRET });
    expect(String(qx[0]!.values[3])).toBe(SECRET);
    const { client: c0 } = fakeClient(() => []);
    await expect(createEndpoint(c0, 'T', { url: 'u', secret: 'curto' })).rejects.toThrow(WebhookRuleError);
    const { client: c1 } = fakeClient(() => [EP]);
    expect(await listEndpoints(c1, 'T')).toHaveLength(1);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_endpoints WHERE id =')) return [{ id: 'e1' }];
      if (q.text.includes('UPDATE webhook_endpoints')) return [{ ...EP, enabled: false, events: ['enrollment.created'] }];
      return [];
    });
    const up = await updateEndpoint(c2, 'T', 'e1', { enabled: false, events: ['enrollment.created'] });
    expect(up.enabled).toBe(false);
    expect(up.events).toEqual(['enrollment.created']);
    const { client: c3 } = fakeClient(() => []);
    await expect(updateEndpoint(c3, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_endpoints WHERE id =')) return [{ id: 'e1' }];
      if (q.text.includes('UPDATE webhook_endpoints')) return [{ ...EP, secret: 'n'.repeat(40) }];
      return [];
    });
    const rot = await rotateSecret(c4, 'T', 'e1');
    expect(rot.secret).toBe('n'.repeat(40));
  });
});

describe('assinatura HMAC (R2)', () => {
  it('sign + verify casam; divergem em body/timestamp errado', () => {
    const body = '{"a":1}';
    const ts = Math.floor(Date.now() / 1000) - 10;
    const { signature, timestamp } = signWebhookPayload(SECRET, body, ts);
    expect(verifyWebhookSignature(SECRET, timestamp, body, signature)).toBe(true);
    expect(verifyWebhookSignature(SECRET, timestamp, '{"a":2}', signature)).toBe(false);
    expect(verifyWebhookSignature('outro'.padEnd(40, 'x'), timestamp, body, signature)).toBe(false);
    // formato t=...,v1=...
    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    const hex = signature.split('v1=')[1]!;
    const manual = createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    expect(hex).toBe(manual);
  });
});

describe('dispatch (R5)', () => {
  const epMatcher = (ep = EP) => (q: Q) => {
    if (q.text.includes('FROM webhook_endpoints')) return [ep];
    if (q.text.includes('FROM outbox_events')) return [{ id: 'oe1', tenant_id: 'T', event_key: 'enrollment.created', payload: '{}' }];
    if (q.text.includes('INSERT INTO webhook_deliveries')) return [{ ...DLV }];
    if (q.text.includes('UPDATE outbox_events')) return [{ id: 'oe1' }];
    return [];
  };
  it('endpoint com match → cria delivery com assinatura; sem match → nada', async () => {
    const { client, queries } = fakeClient(epMatcher());
    const r = await dispatchWebhooks(client, 'T');
    expect(r.created).toBe(1);
    const ins = queries.find((q) => q.text.includes('INSERT INTO webhook_deliveries'))!;
    expect(String(ins.values[6])).toMatch(/v1=/);
    const { client: c2 } = fakeClient(epMatcher({ ...EP, events: ['tuition.settled'] }));
    const r2 = await dispatchWebhooks(c2, 'T');
    expect(r2.created).toBe(0);
  });
});

describe('processDelivery (R3)', () => {
  it('entrega local → DELIVERED 200; falha → retry backoff; 5 tentativas → FAILED/DLQ', async () => {
    // entrega ok
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_deliveries') && q.text.includes('FOR UPDATE')) return [{ ...DLV, attempts: 0 }];
      if (q.text.includes('FROM webhook_endpoints')) return [EP];
      if (q.text.includes("SET status = 'DELIVERED'")) return [{ ...DLV, status: 'DELIVERED', response_code: 200, attempts: 1 }];
      return [];
    });
    const ok = await processDelivery(client, 'T', 'w1');
    expect(ok.status).toBe('DELIVERED');
    expect(ok.responseCode).toBe(200);
    // falha (adapter configurado p/ falhar via attempts altas) → PENDING com next_attempt
    const failAt = (attempts: number) => (q: Q) => {
      if (q.text.includes('FROM webhook_deliveries') && q.text.includes('FOR UPDATE')) return [{ ...DLV, attempts }];
      if (q.text.includes('FROM webhook_endpoints')) return [EP];
      if (q.text.includes("SET status = 'FAILED'")) return [{ ...DLV, status: 'FAILED', attempts: 5 }];
      if (q.text.includes('attempts = $3')) return [{ ...DLV, attempts: attempts + 1, next_attempt_at: new Date() }];
      return [];
    };
    const { client: c2 } = fakeClient(failAt(1));
    const retry = await processDelivery(c2, 'T', 'w1');
    expect(retry.status).toBe('PENDING');
    expect(retry.attempts).toBe(2);
    const { client: c3 } = fakeClient(failAt(4));
    const dlq = await processDelivery(c3, 'T', 'w1');
    expect(dlq.status).toBe('FAILED');
    // delivery já DELIVERED → idempotente
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_deliveries') && q.text.includes('FOR UPDATE')) return [{ ...DLV, status: 'DELIVERED', response_code: 200 }];
      return [];
    });
    const same = await processDelivery(c4, 'T', 'w1');
    expect(same.status).toBe('DELIVERED');
    // 404
    const { client: c5 } = fakeClient(() => []);
    await expect(processDelivery(c5, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('list/DLQ/replay', () => {
  it('filtros; DLQ lista FAILED; replay zera attempts', async () => {
    const { client, queries } = fakeClient(() => [DLV]);
    await listDeliveries(client, 'T', {});
    expect(queries[0]!.values).toEqual(['T']);
    await listDeliveries(client, 'T', { status: 'PENDING', endpointId: 'e1' });
    expect(queries[1]!.values).toEqual(['T', 'PENDING', 'e1']);
    const { client: c2 } = fakeClient(() => [{ ...DLV, status: 'FAILED', attempts: 5 }]);
    const dlq = await listDlq(c2, 'T');
    expect(dlq).toHaveLength(1);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('SELECT status FROM webhook_deliveries')) return [{ status: 'FAILED' }];
      if (q.text.includes('UPDATE webhook_deliveries')) return [{ ...DLV, status: 'PENDING', attempts: 0 }];
      return [];
    });
    const rep = await replayDlq(c3, 'T', 'w1');
    expect(rep.status).toBe('PENDING');
    expect(rep.attempts).toBe(0);
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('SELECT status FROM webhook_deliveries')) return [{ status: 'PENDING' }];
      return [];
    });
    await expect(replayDlq(c4, 'T', 'w1')).rejects.toThrow(WebhookRuleError);
    const { client: c5 } = fakeClient(() => []);
    await expect(replayDlq(c5, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('branches finais webhook', () => {
  it('verify timestamp fora da tolerância e formato inválido; updateEndpoint url; endpoint 404 em update; dispatch payload null; FAILED→process 422; retry backoff path', async () => {
    // verify: timestamp velho (29) e formato inválido (31)
    const body = '{"a":1}';
    const ts = Math.floor(Date.now() / 1000);
    const { signature } = signWebhookPayload(SECRET, body, ts);
    expect(verifyWebhookSignature(SECRET, ts - 1000, body, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, ts, body, 'formato-ruim')).toBe(false);
    // updateEndpoint com url (74 paths com todos patchs)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_endpoints WHERE id =')) return [{ id: 'e1' }];
      if (q.text.includes('UPDATE webhook_endpoints')) return [{ ...EP, url: 'https://novo', events: ['x'], enabled: true }];
      return [];
    });
    const up = await updateEndpoint(c1, 'T', 'e1', { enabled: true, events: ['x'], url: 'https://novo' });
    expect(up.url).toBe('https://novo');
    // updateEndpoint 404 (81)
    const { client: c2 } = fakeClient(() => []);
    await expect(updateEndpoint(c2, 'T', 'zz', { enabled: true })).rejects.toThrow(NotFoundError);
    // dispatch com payload null (119 — ?? {})
    const { client: c3, queries: q3 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_endpoints')) return [{ ...EP, events: ['enrollment.created'] }];
      if (q.text.includes('FROM outbox_events')) return [{ id: 'oe9', tenant_id: 'T', event_key: 'enrollment.created', payload: null }];
      if (q.text.includes('INSERT INTO webhook_deliveries')) return [{ ...DLV }];
      if (q.text.includes('UPDATE outbox_events')) return [{ id: 'oe9' }];
      return [];
    });
    const rd = await dispatchWebhooks(c3, 'T');
    const ins = q3.find((q) => q.text.includes('INSERT INTO webhook_deliveries'))!;
    expect(rd.created).toBe(1);
    expect(String(ins!.values[5])).toBe('{}');
    // processDelivery em FAILED → 422 (146)
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...DLV, status: 'FAILED' }];
      return [];
    });
    await expect(processDelivery(c4, 'T', 'w1')).rejects.toThrow(WebhookRuleError);
    // processDelivery failLocal antes do limite → PENDING backoff (149/158)
    const { client: c5, queries: q5 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...DLV, status: 'PENDING', attempts: 0 }];
      if (q.text.includes("SET status = 'FAILED'")) return [{ ...DLV, status: 'FAILED' }];
      if (q.text.includes('make_interval')) return [{ ...DLV, attempts: 1, next_attempt_at: new Date() }];
      return [];
    });
    const r5 = await processDelivery(c5, 'T', 'w1', { failLocal: true });
    expect(r5.status).toBe('PENDING');
    const upd = q5.find((q) => q.text.includes('make_interval'))!;
    expect(Number(upd.values[3])).toBe(2); // 2^1
  });
});

describe('branches finais webhook 2', () => {
  it('rotateSecret 404; updateEndpoint só url', async () => {
    const { client } = fakeClient(() => []);
    await expect(rotateSecret(client, 'T', 'zz')).rejects.toThrow(NotFoundError);
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM webhook_endpoints WHERE id =')) return [{ id: 'e1' }];
      if (q.text.includes('UPDATE webhook_endpoints')) return [{ ...EP, url: 'https://sourl' }];
      return [];
    });
    const up = await updateEndpoint(c1, 'T', 'e1', { url: 'https://sourl' });
    expect(up.url).toBe('https://sourl');
  });
});

describe('mapWebhookError', () => {
  it('mapeia 422/404/500', () => {
    expect(mapWebhookError(new WebhookRuleError('x')).status).toBe(422);
    expect(mapWebhookError(new NotFoundError('x')).status).toBe(404);
    expect(mapWebhookError(new Error('x')).status).toBe(500);
  });
});
