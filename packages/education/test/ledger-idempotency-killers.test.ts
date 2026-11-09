/**
 * Killers específicos dos mutantes restantes do ledger:
 * fingerprint ?? null → && null; if (opts.idempotencyKey) → true (2 pontos).
 */
import { describe, it, expect } from 'vitest';
import { AuditStore } from '@erp/core/src/audit.js';
import { Ledger, IdempotencyConflictError } from '../src/ledger.js';

const ctxA = { tenantId: 'A' };

describe('killers: fingerprint e guarda de idempotencyKey', () => {
  it('mesma key com reverses DIFERENTES → conflito (mata ?? null → && null)', () => {
    const l = new Ledger(new AuditStore());
    const o1 = l.post('CHARGE', 100, ctxA);
    const o2 = l.post('CHARGE', 100, ctxA); // mesmo valor, id diferente
    l.post('REVERSAL', -100, ctxA, { reverses: o1.id, idempotencyKey: 'rk' });
    // mesmo amount, vínculo DIFERENTE: fingerprint tem que capturar o reverses
    expect(() =>
      l.post('REVERSAL', -100, ctxA, { reverses: o2.id, idempotencyKey: 'rk' }),
    ).toThrow(IdempotencyConflictError);
  });

  it('post SEM idempotencyKey nunca consulta nem grava índice (mata if → true)', () => {
    const l = new Ledger(new AuditStore());
    // dois posts sem key, mesmos atributos: ambos criam (sem key não há dedupe)
    const e1 = l.post('CHARGE', 100, ctxA);
    const e2 = l.post('CHARGE', 100, ctxA);
    expect(e1.id).not.toBe(e2.id);
    expect(l.count()).toBe(2);
    // e um post SEM key não é confundido com uma key undefined no mapa
    expect(() => l.post('PAYMENT', -100, ctxA)).not.toThrow();
    expect(l.count()).toBe(3);
  });

  it('post sem key após post com key não herda dedupe', () => {
    const l = new Ledger(new AuditStore());
    l.post('CHARGE', 100, ctxA, { idempotencyKey: 'k1' });
    // sem key: cria nova entrada (if(true) tentaria dedupar contra 'k1' só se fingerprint igual —
    // mas o correto é NÃO consultar o índice sem key)
    const e = l.post('CHARGE', 100, ctxA);
    expect(e.id).toBe('led-2');
    expect(l.count()).toBe(2);
  });
});
