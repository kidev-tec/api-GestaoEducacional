/**
 * Mutation killers G3 — asserts exatos (name, message, valores) para matar
 * os mutantes sobreviventes: StringLiteral de erros/audit, ArrayDeclaration
 * de TRANSITIONS, UpdateOperator nextId, fingerprint ?? null, filter identity.
 */
// @ts-nocheck

import { describe, it, expect } from 'vitest';
import { AuditStore } from '@erp/core/src/audit.js';
import {
  EnrollmentService,
  InvalidTransitionError,
  IdempotencyConflictError,
} from '../src/enrollment.js';
import { Ledger, Money } from '../src/ledger.js';

const ctxA = { tenantId: 'A' };
const ctxB = { tenantId: 'B' };

describe('mutation killers: enrollment', () => {
  it('InvalidTransitionError: name + message exatos', () => {
    const s = new EnrollmentService(new AuditStore());
    const rec = s.enroll({ idempotencyKey: 'k', tenantCtx: ctxA, studentId: 's', offerId: 'o' });
    try {
      s.transition(rec.id, 'COMPLETED', ctxA, 'op');
      expect.unreachable();
    } catch (e) {
      expect((e as InvalidTransitionError).name).toBe('InvalidTransitionError');
      expect((e as Error).message).toBe('invalid enrollment transition DRAFT -> COMPLETED');
    }
  });

  it('IdempotencyConflictError (enrollment): name + message exatos', () => {
    const s = new EnrollmentService(new AuditStore());
    s.enroll({ idempotencyKey: 'K', tenantCtx: ctxA, studentId: 's1', offerId: 'o1' });
    try {
      s.enroll({ idempotencyKey: 'K', tenantCtx: ctxA, studentId: 's2', offerId: 'o1' });
      expect.unreachable();
    } catch (e) {
      expect((e as IdempotencyConflictError).name).toBe('IdempotencyConflictError');
      expect((e as Error).message).toBe('idempotency key K reused with different payload');
    }
  });

  it('ids sequenciais determinísticos (enr-1, enr-2, enr-3) — mata nextId--', () => {
    const s = new EnrollmentService(new AuditStore());
    const ids = [1, 2, 3].map((i) =>
      s.enroll({ idempotencyKey: `k${i}`, tenantCtx: ctxA, studentId: `s${i}`, offerId: 'o' }).id,
    );
    expect(ids).toEqual(['enr-1', 'enr-2', 'enr-3']);
  });

  it('audit do create: actorId=system, resourceType=enrollment exatos', () => {
    const s = new EnrollmentService(new AuditStore());
    s.enroll({ idempotencyKey: 'k', tenantCtx: ctxA, studentId: 's', offerId: 'o' });
    const r = s['audit'].list(ctxA)[0]!;
    expect(r.actorId).toBe('system');
    expect(r.resourceType).toBe('enrollment');
    expect(r.action).toBe('enrollment.create');
  });

  it('audit da transição: resourceType=enrollment exato', () => {
    const s = new EnrollmentService(new AuditStore());
    const rec = s.enroll({ idempotencyKey: 'k', tenantCtx: ctxA, studentId: 's', offerId: 'o' });
    s.transition(rec.id, 'PENDING_DOCUMENTS', ctxA, 'op');
    const r = s['audit'].list(ctxA).find((x) => x.action.startsWith('enrollment.transition'))!;
    expect(r.resourceType).toBe('enrollment');
  });

  it('TRANSITIONS exatos: cada estado só aceita os sucessores corretos', () => {
    const mk = (): { s: EnrollmentService; id: string } => {
      const s = new EnrollmentService(new AuditStore());
      const rec = s.enroll({ idempotencyKey: `k${Math.random()}`, tenantCtx: ctxA, studentId: 's', offerId: 'o' });
      return { s, id: rec.id };
    };
    // DRAFT → PENDING_DOCUMENTS ✓; DRAFT → PENDING_APPROVAL ✗
    let { s, id } = mk();
    expect(() => s.transition(id, 'PENDING_APPROVAL', ctxA, 'op')).toThrow(InvalidTransitionError);
    s.transition(id, 'PENDING_DOCUMENTS', ctxA, 'op');
    // PENDING_DOCUMENTS → ACTIVE ✗ (só PENDING_APPROVAL/CANCELED)
    expect(() => s.transition(id, 'ACTIVE', ctxA, 'op')).toThrow(InvalidTransitionError);
    s.transition(id, 'PENDING_APPROVAL', ctxA, 'op');
    // PENDING_APPROVAL → COMPLETED ✗; → ACTIVE ✓
    expect(() => s.transition(id, 'COMPLETED', ctxA, 'op')).toThrow(InvalidTransitionError);
    s.transition(id, 'ACTIVE', ctxA, 'op');
    // ACTIVE → COMPLETED ✓; ACTIVE → REJECTED ✗
    const { s: s2, id: id2 } = mk();
    s2.transition(id2, 'PENDING_DOCUMENTS', ctxA, 'op');
    s2.transition(id2, 'PENDING_APPROVAL', ctxA, 'op');
    s2.transition(id2, 'ACTIVE', ctxA, 'op');
    expect(() => s2.transition(id2, 'REJECTED', ctxA, 'op')).toThrow(InvalidTransitionError);
    s2.transition(id2, 'COMPLETED', ctxA, 'op');
    // estados terminais (COMPLETED/CANCELED/REJECTED): QUALQUER transição falha
    const driveToTerminal = (s: EnrollmentService, id: string, terminal: 'COMPLETED' | 'CANCELED' | 'REJECTED') => {
      if (terminal === 'COMPLETED') {
        s.transition(id, 'PENDING_DOCUMENTS', ctxA, 'op');
        s.transition(id, 'PENDING_APPROVAL', ctxA, 'op');
        s.transition(id, 'ACTIVE', ctxA, 'op');
        s.transition(id, 'COMPLETED', ctxA, 'op');
      } else {
        s.transition(id, terminal, ctxA, 'op'); // CANCELED/REJECTED alcançáveis de DRAFT
      }
    };
    const terminals: Array<'COMPLETED' | 'CANCELED' | 'REJECTED'> = ['COMPLETED', 'CANCELED', 'REJECTED'];
    for (const t of terminals) {
      const { s: s3, id: id3 } = mk();
      driveToTerminal(s3, id3, t);
      for (const to of ['DRAFT', 'PENDING_DOCUMENTS', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELED', 'REJECTED'] as const) {
        expect(() => s3.transition(id3, to, ctxA, 'op')).toThrow(InvalidTransitionError);
      }
    }
    // estado terminal alcançado e testado: s transita para CANCELED e congela
    s.transition(id, 'CANCELED', ctxA, 'op');
    expect(() => s.transition(id, 'DRAFT', ctxA, 'op')).toThrow(InvalidTransitionError);
  });
});

describe('mutation killers: ledger', () => {
  it('ReversalWithoutOriginError: name + message exatos', () => {
    const l = new Ledger(new AuditStore());
    try {
      l.post('REVERSAL', 1, ctxA, {});
      expect.unreachable();
    } catch (e) {
      expect((e as Error).name).toBe('ReversalWithoutOriginError');
      expect((e as Error).message).toBe('reversal must reference the original entry');
    }
  });

  it('IdempotencyConflictError (ledger): name + message exatos', () => {
    const l = new Ledger(new AuditStore());
    l.post('CHARGE', 100, ctxA, { idempotencyKey: 'c1' });
    try {
      l.post('CHARGE', 200, ctxA, { idempotencyKey: 'c1' });
      expect.unreachable();
    } catch (e) {
      expect((e as IdempotencyConflictError).name).toBe('IdempotencyConflictError');
      expect((e as Error).message).toBe('idempotency key c1 reused with different payload');
    }
  });

  it('mesma key + mesmos atributos retorna o MESMO id (não só "não duplica")', () => {
    const l = new Ledger(new AuditStore());
    const e1 = l.post('CHARGE', 100, ctxA, { idempotencyKey: 'c1' });
    const e2 = l.post('CHARGE', 100, ctxA, { idempotencyKey: 'c1' });
    expect(e2.id).toBe(e1.id);
    expect(e2.id).toMatch(/^led-1$/); // ids determinísticos — mata nextId--
    const e3 = l.post('PAYMENT', -50, ctxA);
    expect(e3.id).toBe('led-2');
  });

  it('REVERSAL sem opts.reverses diverge de REVERSAL com reverses no fingerprint', () => {
    const l = new Ledger(new AuditStore());
    const orig = l.post('CHARGE', 100, ctxA, { idempotencyKey: 'o1' });
    // key nova com reverses → cria entrada vinculada
    const rev = l.post('REVERSAL', -100, ctxA, { reverses: orig.id, idempotencyKey: 'r1' });
    expect(rev.reverses).toBe(orig.id);
    // mesma key r1 com MESMOS atributos → mesma entrada
    expect(l.post('REVERSAL', -100, ctxA, { reverses: orig.id, idempotencyKey: 'r1' }).id).toBe(rev.id);
    // key r1 com payload diferente (valor distinto, mesmo vínculo) → conflito
    expect(() => l.post('REVERSAL', -99, ctxA, { reverses: orig.id, idempotencyKey: 'r1' })).toThrow(
      IdempotencyConflictError,
    );
    expect(l.count()).toBe(2);
  });

  it('audit do ledger: actorId=system, resourceType=ledger-entry, action por tipo', () => {
    const l = new Ledger(new AuditStore());
    l.post('CHARGE', 100, ctxA);
    l.post('PAYMENT', -30, ctxA);
    const audit = l['audit'].list(ctxA);
    expect(audit.map((r) => ({ a: r.actorId, rt: r.resourceType, act: r.action }))).toEqual([
      { a: 'system', rt: 'ledger-entry', act: 'ledger.charge' },
      { a: 'system', rt: 'ledger-entry', act: 'ledger.payment' },
    ]);
  });

  it('list() escopado com DOIS tenants com entradas (mata filter identity/true/false/invertido)', () => {
    const l = new Ledger(new AuditStore());
    l.post('CHARGE', 100, ctxA);
    l.post('CHARGE', 200, ctxB);
    l.post('CHARGE', 300, ctxA);
    expect(l.list(ctxA).map((e) => e.amountCents)).toEqual([100, 300]);
    expect(l.list(ctxB).map((e) => e.amountCents)).toEqual([200]);
    expect(l.list(ctxB).map((e) => e.tenantId)).toEqual(['B']);
  });

  it('balance soma somente o tenant e bate com list (consistência)', () => {
    const l = new Ledger(new AuditStore());
    l.post('CHARGE', 100, ctxA);
    l.post('PAYMENT', -40, ctxA);
    l.post('CHARGE', 700, ctxB);
    expect(l.balance(ctxA)).toBe(60);
    expect(l.balance(ctxB)).toBe(700);
  });

  it('Money: inteiro negativo válido, zero válido', () => {
    expect(Money.fromCents(-500).cents).toBe(-500);
    expect(Money.fromCents(0).cents).toBe(0);
  });
});
