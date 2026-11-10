/**
 * E03-A — worker do outbox: loop com handlers por type, dedupe, retry/backoff, DLQ.
 * At-least-once: handler PRECISA ser idempotente; worker deduplica por processedAt.
 */
import type { Pool } from 'pg';
import {
  claimPending, markProcessed, failAttempt, isDlq,
  type OutboxRow,
} from '../../../packages/infra/src/outbox-repositories.js';

export type OutboxHandler = (ev: OutboxRow) => Promise<void> | void;

export interface WorkerOpts {
  pool: Pool;
  intervalMs?: number;
  batchSize?: number;
  backoffMs?: number;
  retryBaseMs?: number;
  /** Para testes: rodar um tick único em vez de loop. */
  signal?: AbortSignal;
}

export interface TickResult {
  claimed: number;
  processed: number;
  failed: number;
  skipped: number;
  dlq: number;
}

export class OutboxWorker {
  #handlers = new Map<string, OutboxHandler>();
  readonly #opts: Required<Pick<WorkerOpts, 'intervalMs' | 'batchSize' | 'backoffMs' | 'retryBaseMs'>> & { pool: Pool };
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;
  /** Log em memória p/ observabilidade mínima (E2E usa para esperar o processamento). */
  readonly processedEvents: { id: string; type: string; at: string }[] = [];
  readonly dlqEvents: { id: string; type: string; attempts: number; at: string }[] = [];

  constructor(opts: WorkerOpts) {
    this.#opts = {
      pool: opts.pool,
      intervalMs: opts.intervalMs ?? 1_000,
      batchSize: opts.batchSize ?? 20,
      backoffMs: opts.backoffMs ?? 30_000,
      retryBaseMs: opts.retryBaseMs ?? 5_000,
    };
  }

  on(type: string, handler: OutboxHandler): this {
    this.#handlers.set(type, handler);
    return this;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => { void this.tick(); }, this.#opts.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#running = false;
  }

  /** Um ciclo: claim → handler → markProcessed | failAttempt. */
  async tick(): Promise<TickResult> {
    if (this.#running) return { claimed: 0, processed: 0, failed: 0, skipped: 0, dlq: 0 }; // sem sobreposição
    this.#running = true;
    const res: TickResult = { claimed: 0, processed: 0, failed: 0, skipped: 0, dlq: 0 };
    try {
      const events = await claimPending(this.#opts.pool, { limit: this.#opts.batchSize, backoffMs: this.#opts.backoffMs });
      res.claimed = events.length;
      for (const ev of events) {
        if (ev.processedAt !== null) { res.skipped++; continue; }        // dedupe: já processado
        if (isDlq(ev)) { res.skipped++; res.dlq++; continue; }          // DLQ: não reprocessa
        const handler = this.#handlers.get(ev.type);
        if (!handler) { res.skipped++; continue; }                      // sem handler: fica pending
        try {
          await handler(ev);
          await markProcessed(this.#opts.pool, ev.tenantId, ev.id);
          res.processed++;
          this.processedEvents.push({ id: ev.id, type: ev.type, at: new Date().toISOString() });
        } catch {
          const after = await failAttempt(this.#opts.pool, ev.tenantId, ev.id, this.#opts.retryBaseMs);
          if (isDlq(after)) this.dlqEvents.push({ id: ev.id, type: ev.type, attempts: after.attempts, at: new Date().toISOString() });
          res.failed++;
        }
      }
    } finally {
      this.#running = false;
    }
    return res;
  }
}
