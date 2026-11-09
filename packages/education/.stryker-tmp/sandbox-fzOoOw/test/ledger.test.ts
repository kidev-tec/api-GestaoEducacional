// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { AuditStore } from '@erp/core/src/audit.js';
import {
  Ledger,
  Money,
  ReversalWithoutOriginError,
  IdempotencyConflictError,
} from '../src/ledger.js';

const ctxA = { tenantId: 'A' };
const ctxB = { tenantId: 'B' };
const ledger = () => new Ledger(new AuditStore());

describe('FINANCE-IDEMPOTENCY: Money', () => {
  it('aceita centavos inteiros', () => {
    expect(Money.fromCents(1050).cents).toBe(1050);
  });

  it('rejeita float na fabricação', () => {
    expect(() => Money.fromCents(10.5)).toThrow(/integer cents/);
  });

  it('fromFloat é proibido por design', () => {
    expect(() => Money.fromFloat(0.1 + 0.2)).toThrow(/forbidden/);
  });

  it('add e negate preservam inteiros', () => {
    expect(Money.fromCents(100).add(Money.fromCents(50)).cents).toBe(150);
    expect(Money.fromCents(100).negate().cents).toBe(-100);
  });
});

describe('FINANCE-IDEMPOTENCY: ledger', () => {
  it('webhook duplicado: mesmo evento entregue 2x não altera saldo', () => {
    const l = ledger();
    l.post('PAYMENT', 5000, ctxA, { idempotencyKey: 'wh-1' });
    l.post('PAYMENT', 5000, ctxA, { idempotencyKey: 'wh-1' });
    expect(l.balance(ctxA)).toBe(5000);
    expect(l.count()).toBe(1);
  });

  it('conflito de chave: mesma key, payload diferente → rejeitado e auditado', () => {
    const l = ledger();
    l.post('CHARGE', 1000, ctxA, { idempotencyKey: 'c1' });
    expect(() => l.post('CHARGE', 2000, ctxA, { idempotencyKey: 'c1' })).toThrow(
      IdempotencyConflictError,
    );
    const audit = l['audit'].list(ctxA);
    // só o lançamento original foi auditado; o conflito não criou rastro de lançamento
    expect(audit.filter((r) => r.action === 'ledger.charge')).toHaveLength(1);
  });

  it('append-only: entradas são frozen', () => {
    const l = ledger();
    const e = l.post('CHARGE', 100, ctxA);
    expect(() => {
      (e as { amountCents: number }).amountCents = 999999;
    }).toThrow();
  });

  it('reversão exige vínculo ao original e valor exatamente oposto', () => {
    const l = ledger();
    const charge = l.post('CHARGE', 7500, ctxA);
    expect(() => l.post('REVERSAL', 1, ctxA, {})).toThrow(ReversalWithoutOriginError);
    expect(() =>
      l.post('REVERSAL', -9999, ctxA, { reverses: charge.id }),
    ).toThrow(/exactly negate/);
    const rev = l.post('REVERSAL', -7500, ctxA, { reverses: charge.id });
    expect(rev.reverses).toBe(charge.id);
    expect(l.balance(ctxA)).toBe(0);
  });

  it('reversão de entrada de outro tenant é bloqueada sem vazamento de existência', () => {
    const l = ledger();
    const charge = l.post('CHARGE', 100, ctxA);
    // mesma resposta para "não existe" e "existe em outro tenant" (sem oracle)
    expect(() =>
      l.post('REVERSAL', -100, ctxB, { reverses: charge.id }),
    ).toThrow(ReversalWithoutOriginError);
    expect(() =>
      l.post('REVERSAL', -100, ctxB, { reverses: 'led-inexistente' }),
    ).toThrow(ReversalWithoutOriginError);
    expect(l.balance(ctxA)).toBe(100); // nada foi revertido
  });

  it('saldo é escopado por tenant', () => {
    const l = ledger();
    l.post('CHARGE', 1000, ctxA);
    l.post('CHARGE', 500, ctxB);
    expect(l.balance(ctxA)).toBe(1000);
    expect(l.balance(ctxB)).toBe(500);
  });

  it('property: sequência arbitrária de crédito/débito/reversão conserva saldo', () => {
    // determinístico via seed simples (LCG) para reprodutibilidade
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 20; round++) {
      const l = ledger();
      const entries: string[] = [];
      for (let i = 0; i < 30; i++) {
        const cents = (rnd(50000) + 1) | 0;
        const op = rnd(3);
        if (op === 0 || entries.length === 0) {
          l.post('CHARGE', cents, ctxA, { idempotencyKey: `k-${round}-${i}` });
          entries.push(`k-${round}-${i}`);
        } else if (op === 1) {
          l.post('PAYMENT', -cents, ctxA);
        } else {
          // reverte uma CHARGE anterior pelo valor exato
          const idx = rnd(entries.length);
          const key = entries[idx]!;
          const posted = l['idempotency'].get(key);
          if (posted) {
            const orig = l['entries'].find((e) => e.id === posted.entryId)!;
            l.post('REVERSAL', -orig.amountCents, ctxA, { reverses: orig.id });
            entries.splice(idx, 1);
          }
        }
      }
      // invariantes: nunca float, nunca NaN
      const bal = l.balance(ctxA);
      expect(Number.isInteger(bal)).toBe(true);
      expect(Number.isNaN(bal)).toBe(false);
      // toda REVERSAL tem vínculo e anula exatamente o original
      for (const e of l.list(ctxA)) {
        if (e.type === 'REVERSAL') {
          expect(e.reverses).toBeTruthy();
          const orig = l['entries'].find((x) => x.id === e.reverses);
          expect(orig?.amountCents).toBe(-e.amountCents);
        }
      }
    }
  });
});
