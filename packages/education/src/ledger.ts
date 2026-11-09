/**
 * Finance ledger — spec: specs/canonical/FINANCE-IDEMPOTENCY.md
 * Centavos inteiros (nunca float), append-only, idempotência, reversão vinculada.
 */
import type { TenantContext } from '@erp/core/src/tenancy.js';
import { AuditStore } from '@erp/core/src/audit.js';

/** Valor monetário em centavos inteiros. Fabricação via this, proibindo float. */
export class Money {
  private constructor(readonly cents: number) {
    if (!Number.isInteger(cents)) {
      throw new Error(`Money must be integer cents, got ${cents}`);
    }
  }
  static fromCents(cents: number): Money {
    return new Money(cents);
  }
  /** Proibido: criar Money a partir de float não inteiro. */
  static fromFloat(value: number): never {
    throw new Error('float money is forbidden; use integer cents');
  }
  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }
  negate(): Money {
    return new Money(-this.cents);
  }
}

export type LedgerEntryType = 'CHARGE' | 'PAYMENT' | 'REVERSAL';

export interface LedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly type: LedgerEntryType;
  /** CHARGE/PAYMENT: valor do movimento. REVERSAL: valor negativo vinculado. */
  readonly amountCents: number;
  /** REVERSAL: id do lançamento original. Obrigatório para REVERSAL. */
  readonly reverses?: string;
  readonly idempotencyKey?: string;
}

export class ReversalWithoutOriginError extends Error {
  constructor() {
    super('reversal must reference the original entry');
    this.name = 'ReversalWithoutOriginError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`idempotency key ${key} reused with different payload`);
    this.name = 'IdempotencyConflictError';
  }
}

export class Ledger {
  private entries: LedgerEntry[] = [];
  private nextId = 1;
  private readonly idempotency = new Map<string, { fingerprint: string; entryId: string }>();

  constructor(private readonly audit: AuditStore) {}

  /**
   * Lança entrada append-only. Idempotente por key:
   * mesma key + mesmo payload → retorna original; payload diferente → conflito.
   */
  post(
    type: LedgerEntryType,
    amountCents: number,
    tenantCtx: TenantContext,
    opts: { idempotencyKey?: string; reverses?: string } = {},
  ): LedgerEntry {
    const amount = Money.fromCents(amountCents); // rejeita float na porta
    if (type === 'REVERSAL' && !opts.reverses) {
      throw new ReversalWithoutOriginError();
    }
    if (opts.reverses) {
      const original = this.entries.find((e) => e.id === opts.reverses);
      if (!original || original.tenantId !== tenantCtx.tenantId) {
        // original inexistente ou de outro tenant: sem vazamento de existência
        throw new ReversalWithoutOriginError();
      }
      // REVERSAL não é reversível: cadeias de reversão criariam lançamentos fantasma
      if (original.type === 'REVERSAL') {
        throw new Error('cannot reverse a reversal; reverse the original CHARGE/PAYMENT');
      }
      // reversão explicita vínculo com valor oposto do original
      if (amount.cents !== -original.amountCents) {
        throw new Error('reversal amount must exactly negate the original entry');
      }
    }

    const fingerprint = JSON.stringify([type, amountCents, opts.reverses ?? null]);
    if (opts.idempotencyKey) {
      const previous = this.idempotency.get(`${tenantCtx.tenantId}:${opts.idempotencyKey}`);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw new IdempotencyConflictError(opts.idempotencyKey);
        }
        return this.entries.find((e) => e.id === previous.entryId)!;
      }
    }

    const entry: LedgerEntry = Object.freeze({
      id: `led-${this.nextId++}`,
      tenantId: tenantCtx.tenantId,
      type,
      amountCents: amount.cents,
      reverses: opts.reverses,
      idempotencyKey: opts.idempotencyKey,
    });
    this.entries.push(entry);
    if (opts.idempotencyKey) {
      this.idempotency.set(`${tenantCtx.tenantId}:${opts.idempotencyKey}`, { fingerprint, entryId: entry.id });
    }
    this.audit.append({
      tenantId: tenantCtx.tenantId,
      actorId: 'system',
      action: `ledger.${type.toLowerCase()}`,
      resourceType: 'ledger-entry',
      resourceId: entry.id,
    });
    return entry;
  }

  /** Saldo consolidado do tenant (centavos inteiros). */
  balance(tenantCtx: TenantContext): number {
    return this.entries
      .filter((e) => e.tenantId === tenantCtx.tenantId)
      .reduce((sum, e) => sum + e.amountCents, 0);
  }

  /** Leitura escopada; entries são frozen (append-only). */
  list(tenantCtx: TenantContext): readonly LedgerEntry[] {
    return this.entries.filter((e) => e.tenantId === tenantCtx.tenantId);
  }

  count(): number {
    return this.entries.length;
  }
}
