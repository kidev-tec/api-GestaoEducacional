/**
 * E03-A — worker do outbox: dedupe, retry/backoff, DLQ, sem sobreposição de tick.
 */
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { OutboxWorker } from '../src/outbox-worker.js';
import type { OutboxRow } from '../../../packages/infra/src/outbox-repositories.js';

const ev = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'ev1', tenantId: 'A', type: 'tuition.generated', version: '1.0.0',
  payload: {}, createdAt: '2026-11-09T10:00:00.000Z', processedAt: null, attempts: 0, nextAttemptAt: null, ...over,
});

/** OutboxRow → row snake_case como o pg devolveria. */
const toRow = (e: OutboxRow) => ({
  id: e.id, tenant_id: e.tenantId, type: e.type, version: e.version, payload: e.payload,
  created_at: e.createdAt, processed_at: e.processedAt, attempts: e.attempts, next_attempt_at: e.nextAttemptAt,
});

/**
 * Pool fake com ESTADO: simula outbox_events + processed/attempts transicionando
 * conforme claimPending/markProcessed/failAttempt reais fariam.
 */
function statePool(events: (OutboxRow & { processedAt: string | null; attempts: number; nextAttemptAt: string | null })[]) {
  const calls: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(text: string) {
          calls.push(text);
          if (text.includes('FOR UPDATE SKIP LOCKED')) {
            // cru: devolve TUDO — worker-dedupe (2ª camada) é o objeto destes testes
            const all = events.map(toRow);
            return { rows: all, rowCount: all.length };
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      };
    },
    async query(text: string, values?: unknown[]) {
      calls.push(text);
      if (text.includes('SET processed_at')) {
        const target = events.find((e) => e.id === values?.[0]);
        if (!target) return { rows: [], rowCount: 0 };
        target.processedAt = new Date().toISOString();
        return { rows: [toRow(target)], rowCount: 1 };
      }
      if (text.includes('attempts = attempts + 1')) {
        const target = events.find((e) => e.id === values?.[0] && e.processedAt === null);
        if (!target) return { rows: [], rowCount: 0 };
        target.attempts += 1;
        target.nextAttemptAt = null; // simplificação: DLQ já testada no repo
        return { rows: [toRow(target)], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe('OutboxWorker.tick', () => {
  it('processa evento: handler → markProcessed; log registra', async () => {
    const seen: string[] = [];
    const { pool } = statePool([ev()]);
    const w = new OutboxWorker({ pool });
    w.on('tuition.generated', (e) => { seen.push(e.id); });
    const res = await w.tick();
    expect(res).toMatchObject({ claimed: 1, processed: 1, failed: 0, skipped: 0 });
    expect(seen).toEqual(['ev1']);
    expect(w.processedEvents).toHaveLength(1);
  });

  it('reentrega (evento já processado volta no claim) → skipped, handler NÃO roda 2×', async () => {
    const seen: string[] = [];
    const { pool } = statePool([ev({ processedAt: '2026-11-09T11:00:00.000Z' })]);
    const w = new OutboxWorker({ pool });
    w.on('tuition.generated', (e) => { seen.push(e.id); });
    const res = await w.tick();
    expect(res.skipped).toBe(1);
    expect(res.processed).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('DLQ (attempts >= 5) → skipped + dlq contabilizado, handler não roda', async () => {
    const seen: string[] = [];
    const { pool } = statePool([ev({ attempts: 5 })]);
    const w = new OutboxWorker({ pool });
    w.on('tuition.generated', (e) => { seen.push(e.id); });
    const res = await w.tick();
    expect(res.dlq).toBe(1);
    expect(seen).toHaveLength(0);
  });

  it('handler lança → failAttempt; attempts sobe; registra DLQ ao atingir 5', async () => {
    const { pool } = statePool([ev({ attempts: 4 })]);
    const w = new OutboxWorker({ pool });
    w.on('tuition.generated', () => { throw new Error('boom'); });
    const res = await w.tick();
    expect(res.failed).toBe(1);
    expect(w.dlqEvents).toHaveLength(1);
    expect(w.dlqEvents[0]?.attempts).toBe(5);
  });

  it('sem handler para o type → skipped (fica pending)', async () => {
    const { pool } = statePool([ev({ type: 'unknown.event' })]);
    const w = new OutboxWorker({ pool });
    const res = await w.tick();
    expect(res.skipped).toBe(1);
    expect(res.processed).toBe(0);
  });

  it('claim vazio → tudo zero', async () => {
    const { pool } = statePool([]);
    const w = new OutboxWorker({ pool });
    const res = await w.tick();
    expect(res).toEqual({ claimed: 0, processed: 0, failed: 0, skipped: 0, dlq: 0 });
  });

  it('start/stop não explodem e tick sobreposto retorna zeros', async () => {
    const { pool } = statePool([]);
    const w = new OutboxWorker({ pool, intervalMs: 10 });
    w.start();
    // tick concorrente manual enquanto #running seria true só dentro do await — chamada seca é serial aqui
    const res = await w.tick();
    expect(res.claimed).toBe(0);
    w.stop();
    expect(w.processedEvents).toHaveLength(0);
  });

  it('start() 2× não duplica timer; stop sem start não explode', async () => {
    const { pool } = statePool([]);
    const w = new OutboxWorker({ pool, intervalMs: 10 });
    w.start();
    w.start(); // segundo start deve ser no-op (#timer já setado)
    w.stop();
    w.stop(); // stop idempotente
    expect(w.processedEvents).toHaveLength(0);
  });

  it('tick() reentrante durante execução retorna zeros (guard #running)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { pool } = statePool([ev()]);
    const w = new OutboxWorker({ pool });
    w.on('tuition.generated', () => gate); // handler pendura o 1º tick
    const first = w.tick();
    const overlapped = await w.tick();     // entra enquanto #running=true
    expect(overlapped).toEqual({ claimed: 0, processed: 0, failed: 0, skipped: 0, dlq: 0 });
    release();
    const done = await first;
    expect(done.processed).toBe(1);
  });
});
