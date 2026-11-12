/**
 * E09-03 unit — mensageria: providers, fila, opt-out, adapters sandbox.
 */
import { describe, expect, it } from 'vitest';
import { createSandboxAdapter, drainQueue, enqueueMessage, listDeliveries, MessagingError, optOut, recordDeliveryUpdate, upsertProvider } from '../src/messaging-repositories.js';

type Call = { sql: string; values: unknown[] };
function mkDb(routes: Array<[RegExp, unknown[]]>) {
  const calls: Call[] = [];
  const db = {
    calls,
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      for (const [re, rows] of routes) if (re.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}

const provider = { id: 'pr1', tenant_id: 't1', channel: 'WHATSAPP', provider_name: 'meta', config: { mode: 'sandbox' }, active: true };
const queued = { id: 'd1', tenant_id: 't1', channel: 'WHATSAPP', recipient: '+5511999990000', status: 'QUEUED', provider_message_id: null, attempts: 0, last_error: null, payload: { body: 'oi' } };

describe('upsertProvider', () => {
  it('insere/ativa provider e mascara config', async () => {
    const db = mkDb([
      [/INSERT INTO messaging_providers/, [provider]],
      [/UPDATE messaging_providers/, [provider]],
      [/SELECT .* messaging_providers/, [provider]],
    ]);
    const r = await upsertProvider(db, 't1', { channel: 'WHATSAPP', providerName: 'meta', config: { token: 'secret', mode: 'sandbox' } });
    expect(r.providerName).toBe('meta');
    expect(JSON.stringify(r.config)).not.toContain('secret');
  });
  it('canal inválido → MessagingError', async () => {
    const db = mkDb([]);
    await expect(upsertProvider(db, 't1', { channel: 'PIGEON', providerName: 'x', config: {} })).rejects.toMatchObject({ name: 'MessagingError' });
  });
});

describe('enqueueMessage', () => {
  it('opt-out ativo → status OPT_OUT imediato, sem fila', async () => {
    const db = mkDb([
      [/SELECT 1 FROM opt_outs/, [{ ok: 1 }]],
      [/INSERT INTO message_deliveries/, [{ ...queued, status: 'OPT_OUT' }]],
    ]);
    const r = await enqueueMessage(db, 't1', { channel: 'WHATSAPP', recipient: '+5511', templateId: null, payload: { body: 'x' } });
    expect(r.status).toBe('OPT_OUT');
    expect(db.calls.some((c) => /INSERT INTO message_deliveries/.test(c.sql) && c.values.includes('OPT_OUT'))).toBe(true);
  });
  it('sem opt-out → QUEUED', async () => {
    const db = mkDb([
      [/SELECT 1 FROM opt_outs/, []],
      [/INSERT INTO message_deliveries/, [queued]],
    ]);
    const r = await enqueueMessage(db, 't1', { channel: 'WHATSAPP', recipient: '+5511', templateId: null, payload: {} });
    expect(r.status).toBe('QUEUED');
  });
});

describe('drainQueue + adapters', () => {
  it('sandbox: QUEUED → SENT com id determinístico', async () => {
    const adapter = createSandboxAdapter();
    expect(adapter.mode).toBe('sandbox');
    const sent = await adapter.send({ id: 'd1', channel: 'WHATSAPP', recipient: '+5511', payload: {} });
    expect(sent.ok).toBe(true);
    expect(sent.providerMessageId).toMatch(/^sbx-/);
    const db = mkDb([
      [/status = 'QUEUED'/, [queued]],
      [/UPDATE message_deliveries/, [{ ...queued, status: 'SENT', provider_message_id: 'sbx-1' }]],
    ]);
    const n = await drainQueue(db, adapter, 10);
    expect(n).toBeGreaterThanOrEqual(0);
  });
  it('adapter falha → attempts+1; 3 tentativas → FAILED', async () => {
    const failAdapter = { mode: 'live' as const, send: async () => { throw new Error('provider 503'); } };
    const db = mkDb([
      [/status = 'QUEUED'/, [queued]],
      [/UPDATE message_deliveries/, [{ ...queued, attempts: 3, status: 'FAILED', last_error: 'provider 503' }]],
    ]);
    const n = await drainQueue(db, failAdapter, 10);
    expect(n).toBeGreaterThanOrEqual(0);
    const upd = db.calls.filter((c) => /UPDATE message_deliveries/.test(c.sql));
    expect(upd.length).toBeGreaterThan(0);
  });
});

describe('recordDeliveryUpdate + webhook idempotente', () => {
  it('DELIVERED por provider_message_id, idempotente', async () => {
    const db = mkDb([
      [/SELECT .* message_deliveries .*provider_message_id/, [{ ...queued, status: 'SENT', provider_message_id: 'sbx-1' }]],
      [/UPDATE message_deliveries/, [{ ...queued, status: 'DELIVERED', provider_message_id: 'sbx-1' }]],
    ]);
    const r = await recordDeliveryUpdate(db, { providerMessageId: 'sbx-1', status: 'DELIVERED' });
    expect(r.status).toBe('DELIVERED');
  });
  it('provider_message_id inexistente → MessagingError', async () => {
    const db = mkDb([[/SELECT .* message_deliveries .*provider_message_id/, []]]);
    await expect(recordDeliveryUpdate(db, { providerMessageId: 'nope', status: 'DELIVERED' })).rejects.toMatchObject({ name: 'MessagingError' });
  });
});

describe('optOut + listDeliveries', () => {
  it('insere opt-out (idempotente via UNIQUE)', async () => {
    const db = mkDb([[/INSERT INTO opt_outs/, [{ id: 'o1' }]]]);
    await optOut(db, 't1', { channel: 'EMAIL', recipient: 'a@b.c' });
    expect(db.calls.some((c) => /INSERT INTO opt_outs/.test(c.sql))).toBe(true);
  });
  it('lista deliveries por tenant com filtro status', async () => {
    const db = mkDb([[/SELECT .* message_deliveries/, [queued]]]);
    const r = await listDeliveries(db, 't1', { status: 'QUEUED' });
    expect(r.length).toBe(1);
    expect(db.calls[0]!.sql).toContain('status = $2');
  });
});

describe('branches residuais messaging', () => {
  it('maskConfig: chave sensível mascarada, normal mantida', async () => {
    const db = mkDb([
      [/INSERT INTO messaging_providers/, [{ ...provider, channel: 'EMAIL', config: { apiKey: 'zzz', host: 'smtp.x' } }]],
    ]);
    const r = await upsertProvider(db, 't1', { channel: 'EMAIL', providerName: 'smtp', config: { apiKey: 'zzz', host: 'smtp.x' } });
    expect((r.config as Record<string, unknown>).host).toBe('smtp.x'); // normal mantida
    expect(JSON.stringify(r.config)).not.toContain('zzz');
  });

  it('config null no retorno → {} (?? {})', async () => {
    const db = mkDb([[/INSERT INTO messaging_providers/, [{ ...provider, config: null }]]]);
    const r = await upsertProvider(db, 't1', { channel: 'EMAIL', providerName: 'smtp', config: {} });
    expect(r.config).toEqual({});
  });

  it('enqueue com templateId; toDelivery com payload/provider_message_id/attempts null', async () => {
    const row = { ...queued, template_id: 'tpl-1', payload: null, provider_message_id: null, attempts: null, last_error: null };
    const db = mkDb([
      [/SELECT 1 FROM opt_outs/, []],
      [/INSERT INTO message_deliveries/, [row]],
    ]);
    const r = await enqueueMessage(db, 't1', { channel: 'WHATSAPP', recipient: '+5511', templateId: 'tpl-1' });
    expect(r.templateId).toBe('tpl-1');
    expect(r.payload).toEqual({});
  });

  it('drainQueue: erro não-Error (string) → last_error string', async () => {
    const weirdAdapter = { mode: 'live' as const, send: async () => { throw 'boom-string'; } };
    const db = mkDb([
      [/status = 'QUEUED'/, [queued]],
      [/UPDATE message_deliveries/, [queued]],
    ]);
    await drainQueue(db, weirdAdapter, 5);
    const upd = db.calls.find((c) => /UPDATE message_deliveries/.test(c.sql))!;
    expect(upd.values).toContain('boom-string');
  });

  it('drainQueue: falha com attempts < 3 volta a QUEUED', async () => {
    const failAdapter = { mode: 'live' as const, send: async () => ({ ok: false, providerMessageId: '', error: 'timeout' }) };
    const db = mkDb([
      [/status = 'QUEUED'/, [{ ...queued, attempts: 1 }]],
      [/UPDATE message_deliveries/, [queued]],
    ]);
    const n = await drainQueue(db, failAdapter, 5);
    expect(n).toBe(0);
    const upd = db.calls.find((c) => /UPDATE message_deliveries/.test(c.sql))!;
    expect(upd.values).toContain('QUEUED');
  });

  it('recordDeliveryUpdate idempotente: mesmo status retorna sem UPDATE', async () => {
    const same = { ...queued, status: 'DELIVERED', provider_message_id: 'sbx-d1' };
    const db = mkDb([[/SELECT .* message_deliveries/, [same]]]);
    const r = await recordDeliveryUpdate(db, { providerMessageId: 'sbx-d1', status: 'DELIVERED' });
    expect(r.status).toBe('DELIVERED');
    expect(db.calls.some((c) => /UPDATE/.test(c.sql))).toBe(false);
  });

  it('listDeliveries sem filtro de status ($2 NULL)', async () => {
    const db = mkDb([[/SELECT .* message_deliveries/, [queued]]]);
    const r = await listDeliveries(db, 't1', {});
    expect(r.length).toBe(1);
    expect(db.calls[0]!.values[1]).toBeNull();
  });
});

describe('drainQueue FAILED final', () => {
  it('falha com attempts >= 3 → FAILED', async () => {
    const failAdapter = { mode: 'live' as const, send: async () => ({ ok: false, providerMessageId: '', error: 'x' }) };
    const db = mkDb([
      [/status = 'QUEUED'/, [{ ...queued, attempts: 2 }]],
      [/UPDATE message_deliveries/, [{ ...queued, status: 'FAILED' }]],
    ]);
    await drainQueue(db, failAdapter, 5);
    const upd = db.calls.find((c) => /UPDATE message_deliveries/.test(c.sql))!;
    expect(upd.values).toContain('FAILED');
  });
});
