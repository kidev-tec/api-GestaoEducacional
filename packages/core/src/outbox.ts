/**
 * Outbox transacional + eventos versionados idempotentes
 * (ARCHITECTURE.md §4: at-least-once não pode duplicar efeito de negócio).
 */
export interface OutboxEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly tenantId: string;
  readonly payload: T;
  readonly createdAt: string;
  processedAt: string | null;
}

export class Outbox {
  private events: OutboxEvent[] = [];
  private processedIds = new Set<string>();

  /** Enfileira evento na MESMA transação da escrita de negócio (caller garante). */
  enqueue(
    id: string,
    type: string,
    version: string,
    tenantCtx: { tenantId: string },
    payload: unknown,
    now = new Date().toISOString(),
  ): Readonly<OutboxEvent> {
    if (this.events.some((e) => e.id === id)) {
      throw new Error(`duplicate outbox id ${id}`);
    }
    const ev: OutboxEvent = {
      id,
      type,
      version,
      tenantId: tenantCtx.tenantId,
      payload: payload,
      createdAt: now,
      processedAt: null,
    };
    this.events.push(ev);
    return ev;
  }

  /**
   * Delivery at-least-once com deduplicação: reprocessar o mesmo id
   * NÃO executa o handler duas vezes (idempotência obrigatória).
   */
  process(handler: (ev: Readonly<OutboxEvent>) => void): { processed: number; skipped: number } {
    let processed = 0;
    let skipped = 0;
    for (const ev of this.events) {
      if (ev.processedAt !== null || this.processedIds.has(ev.id)) {
        skipped++;
        continue;
      }
      handler(ev);
      ev.processedAt = new Date().toISOString();
      this.processedIds.add(ev.id);
      processed++;
    }
    return { processed, skipped };
  }

  pending(tenantCtx: { tenantId: string }): readonly Readonly<OutboxEvent>[] {
    return this.events.filter((e) => e.tenantId === tenantCtx.tenantId && e.processedAt === null);
  }
}

/** Handler idempotente de exemplo: efeito de negócio executado 1× por eventId. */
export class IdempotentEffectRunner {
  private applied = new Set<string>();
  readonly appliedEffects: string[] = [];

  run(eventId: string, effect: string): boolean {
    const key = `${eventId}:${effect}`;
    if (this.applied.has(key)) return false;
    this.applied.add(key);
    this.appliedEffects.push(effect);
    return true;
  }
}
