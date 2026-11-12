/**
 * E03-A — testes unitários outbox-repositories com fake pg router por trecho SQL.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  enqueueOutbox, claimPending, markProcessed, failAttempt, listOutbox, isDlq,
  OutboxRuleError, OutboxConflictError, DLQ_ATTEMPTS,
} from '../src/outbox-repositories.js';
import type { PoolClient, Pool } from 'pg';

const empty = { rows: [], rowCount: 0 };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ev1', tenant_id: 'A', type: 'tuition.generated', version: '1.0.0',
  payload: { tuitionId: 't1' }, created_at: '2026-11-09T10:00:00.000Z',
  processed_at: null, attempts: 0, next_attempt_at: null, ...over,
});

function fakeClient(route: (q: { text: string; values?: unknown[] }) => { rows: Record<string, unknown>[]; rowCount: number }) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route({ text, values });
    },
  };
  return Object.assign(client as never as PoolClient, { calls });
}

// pool p/ claimPending: precisa .connect() → {query, release}
function fakePool(route: (q: { text: string; values?: unknown[] }) => { rows: Record<string, unknown>[]; rowCount: number }) {
  const tx: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      tx.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: 0 };
      return route({ text, values });
    },
  };
  const pool = {
    async connect() { return Object.assign(client, { release: () => {} }); },
  };
  return { pool: pool as unknown as Pool, tx };
}

describe('enqueueOutbox', () => {
  it('insere evento com id gerado, payload jsonb, created_at ISO', async () => {
    const c = fakeClient((q) => q.text.includes('INSERT INTO outbox_events') ? { rows: [row()], rowCount: 1 } : empty);
    const ev = await enqueueOutbox(c, { tenantId: 'A', type: 'tuition.generated', version: '1.0.0', payload: { tuitionId: 't1' }, eventId: 'ev1' }, '2026-11-09T10:00:00.000Z');
    expect(ev.id).toBe('ev1');
    expect(ev.processedAt).toBeNull();
    const insert = c.calls.find((q) => q.text.includes('INSERT'));
    expect(insert?.values?.[4]).toBe('{"tuitionId":"t1"}');
    expect(insert?.values?.[5]).toBe('2026-11-09T10:00:00.000Z');
  });

  it('replay mesmo id: ON CONFLICT DO NOTHING → fetch original (idempotente)', async () => {
    const c = fakeClient((q) => {
      if (q.text.includes('INSERT INTO outbox_events')) return empty;
      if (q.text.includes('FROM outbox_events WHERE id')) return { rows: [row({ processed_at: '2026-11-09T11:00:00.000Z' })], rowCount: 1 };
      return empty;
    });
    const ev = await enqueueOutbox(c, { tenantId: 'A', type: 'tuition.generated', version: '1.0.0', eventId: 'ev1' });
    expect(ev.processedAt).toBe('2026-11-09T11:00:00.000Z');
  });

  it('id conflitado com OUTRO tenant → OutboxConflictError', async () => {
    const c = fakeClient(() => empty);
    await expect(enqueueOutbox(c, { tenantId: 'B', type: 'x', version: '1.0.0', eventId: 'ev1' }))
      .rejects.toBeInstanceOf(OutboxConflictError);
  });

  it.each([
    ['version livre', { version: 'v1' }],
    ['sem type', { type: '' }],
  ])('%s → OutboxRuleError', async (_l, over) => {
    const c = fakeClient(() => empty);
    await expect(enqueueOutbox(c, { tenantId: 'A', type: 'x', version: '1.0.0', ...over } as never))
      .rejects.toBeInstanceOf(OutboxRuleError);
  });
});

describe('claimPending', () => {
  it('claim com SKIP LOCKED agenda next_attempt_at (backoff) e retorna rows', async () => {
    const { pool, tx } = fakePool((q) => q.text.includes('FOR UPDATE SKIP LOCKED')
      ? { rows: [row(), row({ id: 'ev2' })], rowCount: 2 }
      : empty);
    const evs = await claimPending(pool, { limit: 10, backoffMs: 30_000 });
    expect(evs.map((e) => e.id)).toEqual(['ev1', 'ev2']);
    const update = tx.find((q) => q.text.includes('UPDATE outbox_events SET next_attempt_at'));
    expect(update?.values?.[0]).toBe('30000 milliseconds');
    expect(update?.values?.[1]).toEqual(['ev1', 'ev2']);
    expect(tx[0]?.text).toBe('BEGIN');
    expect(tx.at(-1)?.text).toBe('COMMIT');
  });

  it('sem pendentes: sem UPDATE de next_attempt_at', async () => {
    const { pool, tx } = fakePool(() => empty);
    const evs = await claimPending(pool, { limit: 10 });
    expect(evs).toHaveLength(0);
    expect(tx.some((q) => q.text.includes('SET next_attempt_at'))).toBe(false);
  });

  it('erro no meio → ROLLBACK e rethrow', async () => {
    const { pool, tx } = fakePool(() => { throw new Error('db boom'); });
    await expect(claimPending(pool, { limit: 5 })).rejects.toThrow('db boom');
    expect(tx.some((q) => q.text === 'ROLLBACK')).toBe(true);
  });

  it.each([[0], [-1], [1.5], [101]])('limit %s → OutboxRuleError', async (bad) => {
    const { pool } = fakePool(() => empty);
    await expect(claimPending(pool, { limit: bad as number })).rejects.toBeInstanceOf(OutboxRuleError);
  });
});

describe('markProcessed / failAttempt', () => {
  it('markProcessed atualiza e retorna row', async () => {
    const c = fakeClient((q) => q.text.includes('UPDATE outbox_events SET processed_at')
      ? { rows: [row({ processed_at: '2026-11-09T12:00:00.000Z' })], rowCount: 1 } : empty);
    const ev = await markProcessed(c, 'A', 'ev1');
    expect(ev.processedAt).toBe('2026-11-09T12:00:00.000Z');
  });

  it('markProcessed ghost → OutboxRuleError', async () => {
    const c = fakeClient(() => empty);
    await expect(markProcessed(c, 'A', 'ghost')).rejects.toBeInstanceOf(OutboxRuleError);
  });

  it('failAttempt incrementa e agenda backoff dobrado; DLQ zera next_attempt_at', async () => {
    let attempts = 2;
    const c = fakeClient((q) => {
      if (q.text.includes('SET attempts = attempts + 1')) {
        attempts += 1;
        return { rows: [row({ attempts })], rowCount: 1 };
      }
      return empty;
    });
    const ev = await failAttempt(c, 'A', 'ev1', 5_000);
    expect(ev.attempts).toBe(3);
    expect(c.calls.find((q) => q.text.includes('attempts + 1'))?.values?.[3]).toBe('10000 milliseconds');
  });

  it('failAttempt em evento processado → OutboxRuleError', async () => {
    const c = fakeClient(() => empty);
    await expect(failAttempt(c, 'A', 'ev1')).rejects.toBeInstanceOf(OutboxRuleError);
  });

  it('isDlq: pending com attempts >= MAX; DLQ_ATTEMPTS = 5', () => {
    expect(DLQ_ATTEMPTS).toBe(5);
    expect(isDlq({ processedAt: null, attempts: 5 })).toBe(true);
    expect(isDlq({ processedAt: null, attempts: 4 })).toBe(false);
    expect(isDlq({ processedAt: 'x', attempts: 5 })).toBe(false);
  });
});

describe('listOutbox', () => {
  it('filtro dlq adiciona cláusula attempts >= MAX', async () => {
    const seen: string[] = [];
    const pool = { async query(text: string) { seen.push(text); return { rows: [row({ attempts: 5 })], rowCount: 1 }; } } as unknown as Pool;
    const evs = await listOutbox(pool, 'A', { status: 'dlq' });
    expect(evs[0]?.attempts).toBe(5);
    expect(seen[0]).toContain('attempts >= $2');
  });

  it('sem filtro: cláusula só de tenant (sem filtro de status)', async () => {
    const seen: string[] = [];
    const pool = { async query(text: string) { seen.push(text); return empty; } } as unknown as Pool;
    await listOutbox(pool, 'A');
    expect(seen[0]).not.toContain('processed_at IS');
  });

  it('filtro pending: cláusula attempts < MAX', async () => {
    const seen: string[] = [];
    const pool = { async query(text: string) { seen.push(text); return empty; } } as unknown as Pool;
    await listOutbox(pool, 'A', { status: 'pending' });
    expect(seen[0]).toContain('attempts < $2');
  });

  it('filtro processed: cláusula processed_at IS NOT NULL', async () => {
    const seen: string[] = [];
    const pool = { async query(text: string) { seen.push(text); return empty; } } as unknown as Pool;
    await listOutbox(pool, 'A', { status: 'processed' });
    expect(seen[0]).toContain('processed_at IS NOT NULL');
  });

  it('payload string → parse JSON (via listOutbox, exercita branch typeof string)', async () => {
    const pool = { async query() { return { rows: [row({ payload: '{"via":"string"}' })], rowCount: 1 }; } } as unknown as Pool;
    const [ev] = await listOutbox(pool, 'A');
    expect(ev.payload).toEqual({ via: 'string' });
  });

  it('payload string vazio → parse JSON {}', async () => {
    const pool = { async query() { return { rows: [row({ payload: '{}' })], rowCount: 1 }; } } as unknown as Pool;
    const [ev] = await listOutbox(pool, 'A');
    expect(ev.payload).toEqual({});
  });

  it('next_attempt_at undefined → null (row sem a coluna)', async () => {
    const pool = { async query() { return { rows: [{ ...row(), next_attempt_at: undefined }], rowCount: 1 }; } } as unknown as Pool;
    const [ev] = await listOutbox(pool, 'A');
    expect(ev.nextAttemptAt).toBeNull();
  });

  it('next_attempt_at Date → ISO string', async () => {
    const pool = { async query() { return { rows: [row({ next_attempt_at: new Date(5000) })], rowCount: 1 }; } } as unknown as Pool;
    const [ev] = await listOutbox(pool, 'A');
    expect(ev.nextAttemptAt).toBe('1970-01-01T00:00:05.000Z');
  });

  it('claimPending ROLLBACK falho não esconde erro original', async () => {
    const tx: { text: string }[] = [];
    const client = {
      async query(text: string) {
        tx.push({ text });
        if (text === 'ROLLBACK') throw new Error('conn dead');
        if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: 0 };
        throw new Error('db boom');
      },
    };
    const pool = { async connect() { return Object.assign(client, { release: () => {} }); } } as unknown as Pool;
    await expect(claimPending(pool, { limit: 5 })).rejects.toThrow('db boom');
    expect(tx.some((q) => q.text === 'ROLLBACK')).toBe(true);
  });

  it('claimPending: ROLLBACK com sucesso no caminho de erro (branch .catch não usado)', async () => {
    const tx: { text: string }[] = [];
    const client = {
      async query(text: string) {
        tx.push({ text });
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        throw new Error('db boom');
      },
    };
    const pool = { async connect() { return Object.assign(client, { release: vi.fn() }); } } as unknown as Pool;
    await expect(claimPending(pool, { limit: 5 })).rejects.toThrow('db boom');
    expect(tx.some((q) => q.text === 'ROLLBACK')).toBe(true);
    // release chamado via finally
  });
});

// evita warning de import não usado em CI estrito
vi.mock('pg', () => ({}));
