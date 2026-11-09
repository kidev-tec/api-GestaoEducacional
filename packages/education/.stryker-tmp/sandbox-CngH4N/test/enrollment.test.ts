// @ts-nocheck
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
  s.enroll({ idempotencyKey: key, tenantCtx: ctx, studentId, offerId });

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

  it('transição cross-tenant é bloqueada', () => {
    const s = svc();
    const rec = enroll(s, 'k', ctxA);
    expect(() => s.transition(rec.id, 'CANCELED', ctxB, 'atk')).toThrow(
      TenantIsolationViolationError,
    );
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
