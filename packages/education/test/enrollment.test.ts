import { describe, it, expect } from 'vitest';
import { AuditStore } from '@erp/core/src/audit.js';
import { TenantIsolationViolationError } from '@erp/core/src/tenancy.js';
import {
  EnrollmentService,
  InvalidTransitionError,
  IdempotencyConflictError,
  type EnrollmentRecord,
} from '../src/enrollment.js';

const ctxA = { tenantId: 'A' };
const ctxB = { tenantId: 'B' };

const svc = () => new EnrollmentService(new AuditStore());
const enroll = (
  s: EnrollmentService,
  key: string,
  ctx = ctxA,
  studentId = 'stu-1',
  offerId = 'off-1',
): EnrollmentRecord =>
  s.enroll({ idempotencyKey: key, tenantCtx: ctx, studentId, offerId, studentRef: { tenantId: ctx.tenantId }, offerRef: { tenantId: ctx.tenantId } });

describe('EDU-ENROLLMENT: criação', () => {
  it('cenario feliz: matrícula válida no tenant autorizado, estado inicial DRAFT', () => {
    const s = svc();
    const rec = enroll(s, 'k1');
    expect(rec.state).toBe('DRAFT');
    expect(rec.tenantId).toBe('A');
    const audit = s['audit'].list(ctxA);
    expect(audit.some((r) => r.action === 'enrollment.create')).toBe(true);
  });

  it('duplo clique: mesma key repetida cria exatamente UMA matrícula', () => {
    const s = svc();
    const r1 = enroll(s, 'K');
    const r2 = enroll(s, 'K');
    expect(r2).toBe(r1); // mesmo recurso
    expect(s['records'].size).toBe(1);
  });

  it('mesma key com payload diferente → conflito', () => {
    const s = svc();
    enroll(s, 'K', ctxA, 'stu-1', 'off-1');
    expect(() => enroll(s, 'K', ctxA, 'stu-2', 'off-1')).toThrow(
      IdempotencyConflictError,
    );
  });

  it('keys diferentes para mesmo aluno+turma criam matrículas distintas (regra: proibido duplicar só com mesma key)', () => {
    const s = svc();
    const r1 = enroll(s, 'k1');
    const r2 = enroll(s, 'k2');
    expect(r1.id).not.toBe(r2.id);
    expect(s['records'].size).toBe(2);
  });

  it('referência cruzada: tenant não revela dados privados', () => {
    const s = svc();
    const rec = enroll(s, 'kA', ctxA, 'stu-B', 'off-B');
    // operador do tenant B tenta ler matrícula do tenant A
    expect(() => s.get(rec.id, ctxB)).toThrow(TenantIsolationViolationError);
    // e a mensagem não expõe studentId
    try {
      s.get(rec.id, ctxB);
    } catch (e) {
      expect((e as Error).message).not.toContain('stu-B');
    }
  });
});

describe('EDU-ENROLLMENT: state machine', () => {
  it('fluxo completo DRAFT → ... → COMPLETED', () => {
    const s = svc();
    const rec = enroll(s, 'k');
    s.transition(rec.id, 'PENDING_DOCUMENTS', ctxA, 'op1');
    s.transition(rec.id, 'PENDING_APPROVAL', ctxA, 'op1');
    s.transition(rec.id, 'ACTIVE', ctxA, 'op2');
    const done = s.transition(rec.id, 'COMPLETED', ctxA, 'op2');
    expect(done.state).toBe('COMPLETED');
  });

  it('transição inválida rejeitada (CANCELED → ACTIVE)', () => {
    const s = svc();
    const rec = enroll(s, 'k');
    s.transition(rec.id, 'CANCELED', ctxA, 'op1');
    expect(() => s.transition(rec.id, 'ACTIVE', ctxA, 'op1')).toThrow(
      InvalidTransitionError,
    );
  });

  it('DRAFT → ACTIVE direto é inválido', () => {
    const s = svc();
    const rec = enroll(s, 'k');
    expect(() => s.transition(rec.id, 'ACTIVE', ctxA, 'op1')).toThrow(
      InvalidTransitionError,
    );
  });

  it('estados terminais não transitam', () => {
    const s = svc();
    const rec = enroll(s, 'k');
    s.transition(rec.id, 'REJECTED', ctxA, 'op1');
    expect(() => s.transition(rec.id, 'DRAFT', ctxA, 'op1')).toThrow(
      InvalidTransitionError,
    );
  });

  it('mutação de TRANSITIONS: sucessor inválido/string vazia rejeitado', () => {
    const s = new EnrollmentService(new AuditStore());
    const rec = s.enroll({ idempotencyKey: 'kx', tenantCtx: ctxA, studentId: 's', offerId: 'o', studentRef: { tenantId: 'A' }, offerRef: { tenantId: 'A' } });
    // nenhum estado aceita transitar para valor fora da lista de sucessores
    for (const to of ['', 'Stryker was here', 'ACTIVE '] as const) {
      expect(() => s.transition(rec.id, to as never, ctxA, 'op')).toThrow(
        InvalidTransitionError,
      );
    }
    // e do terminal, valor estranho também falha (mata ArrayDeclaration nos terminais)
    s.transition(rec.id, 'CANCELED', ctxA, 'op');
    expect(() => s.transition(rec.id, '' as never, ctxA, 'op')).toThrow(InvalidTransitionError);
    expect(() => s.transition(rec.id, 'Stryker was here' as never, ctxA, 'op')).toThrow(
      InvalidTransitionError,
    );
  });

  it('enroll valida referências de aluno E oferta contra o tenant do operador', () => {
    const s = new EnrollmentService(new AuditStore());
    // referência de aluno persistida em OUTRO tenant: matrícula é negada ANTES de criar
    expect(() =>
      s.enroll({
        idempotencyKey: 'kx-tenant',
        tenantCtx: ctxA,
        studentId: 'stu-B',
        offerId: 'off-A',
        studentRef: { tenantId: 'B' },
        offerRef: { tenantId: 'A' },
      }),
    ).toThrow(TenantIsolationViolationError);
    // nada foi criado nem auditado
    expect(s['records'].size).toBe(0);
    expect(s['audit'].count()).toBe(0);
    // referência de oferta de outro tenant: mesmo comportamento
    expect(() =>
      s.enroll({
        idempotencyKey: 'kx-tenant2',
        tenantCtx: ctxA,
        studentId: 'stu-A',
        offerId: 'off-B',
        studentRef: { tenantId: 'A' },
        offerRef: { tenantId: 'B' },
      }),
    ).toThrow(TenantIsolationViolationError);
    expect(s['records'].size).toBe(0);
    // referências válidas criam normalmente
    const rec = s.enroll({
      idempotencyKey: 'kv',
      tenantCtx: ctxA,
      studentId: 's',
      offerId: 'o',
      studentRef: { tenantId: 'A' },
      offerRef: { tenantId: 'A' },
    });
    expect(rec.tenantId).toBe('A');
    // cross-check: get de outro tenant continua bloqueado (invariante ponta a ponta)
    expect(() => s.get(rec.id, ctxB)).toThrow(TenantIsolationViolationError);
  });

  it('cada transição gera audit com ator', () => {
    const s = svc();
    const rec = enroll(s, 'k');
    s.transition(rec.id, 'PENDING_DOCUMENTS', ctxA, 'maria');
    const audit = s['audit'].list(ctxA);
    const t = audit.find((r) => r.action === 'enrollment.transition.PENDING_DOCUMENTS');
    expect(t?.actorId).toBe('maria');
  });

  it('get de matrícula inexistente falha sem vazar tenant', () => {
    const s = svc();
    expect(() => s.get('nope', ctxA)).toThrow(/not found/);
  });
});
