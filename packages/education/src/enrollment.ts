/**
 * Enrollment — spec: specs/canonical/EDU-ENROLLMENT.md
 * State machine + idempotency key + tenant invariant + audit.
 */
import type { TenantContext } from '@erp/core/src/tenancy.js';
import { assertBelongsToTenant } from '@erp/core/src/tenancy.js';
import { AuditStore } from '@erp/core/src/audit.js';

export type EnrollmentState =
  | 'DRAFT'
  | 'PENDING_DOCUMENTS'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELED'
  | 'REJECTED';

const TRANSITIONS: Record<EnrollmentState, readonly EnrollmentState[]> = {
  DRAFT: ['PENDING_DOCUMENTS', 'CANCELED', 'REJECTED'],
  PENDING_DOCUMENTS: ['PENDING_APPROVAL', 'CANCELED'],
  PENDING_APPROVAL: ['ACTIVE', 'CANCELED', 'REJECTED'],
  ACTIVE: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
  REJECTED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: EnrollmentState, to: EnrollmentState) {
    super(`invalid enrollment transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface EnrollmentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly offerId: string;
  state: EnrollmentState;
}

export type TenantRef = { readonly tenantId: string };

export interface EnrollmentCommand {
  idempotencyKey: string;
  tenantCtx: TenantContext;
  studentId: string;
  offerId: string;
  /** Referência verificável do aluno (registro real do módulo de pessoas). */
  studentRef: TenantRef;
  /** Referência verificável da oferta/turma (registro real do módulo acadêmico). */
  offerRef: TenantRef;
}

export type ConflictError = Error & { readonly name: 'IdempotencyConflictError' };

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`idempotency key ${key} reused with different payload`);
    this.name = 'IdempotencyConflictError';
  }
}

function assertRefInTenant(ref: TenantRef, ctx: TenantContext): void {
  assertBelongsToTenant(ref, ctx);
}

export class EnrollmentService {
  private readonly records = new Map<string, EnrollmentRecord>();
  /** key -> { fingerprint, result } — idempotência de criação. */
  private readonly idempotency = new Map<
    string,
    { fingerprint: string; enrollmentId: string }
  >();
  private nextId = 1;

  constructor(private readonly audit: AuditStore) {}

  /**
   * Cria matrícula com idempotência:
   * - mesma key + payload compatível → retorna a matrícula original (sem criar 2ª)
   * - mesma key + payload diferente → IdempotencyConflictError
   */
  enroll(cmd: EnrollmentCommand): EnrollmentRecord {
    const fingerprint = JSON.stringify([
      cmd.tenantCtx.tenantId,
      cmd.studentId,
      cmd.offerId,
    ]);
    const previous = this.idempotency.get(cmd.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(cmd.idempotencyKey);
      }
      return this.records.get(previous.enrollmentId)!;
    }

    // invariante: referências de aluno e oferta são verificadas contra o tenant
    // do operador ANTES da persistência ( callers passam registros reais de outros
    // módulos; quando o tenant diverge, o enroll falha sem criar registro).
    assertRefInTenant(cmd.studentRef, cmd.tenantCtx);
    assertRefInTenant(cmd.offerRef, cmd.tenantCtx);

    const id = `enr-${this.nextId++}`;
    const rec: EnrollmentRecord = {
      id,
      tenantId: cmd.tenantCtx.tenantId,
      studentId: cmd.studentId,
      offerId: cmd.offerId,
      state: 'DRAFT',
    };
    this.records.set(id, rec);
    this.idempotency.set(cmd.idempotencyKey, { fingerprint, enrollmentId: id });
    this.audit.append({
      tenantId: rec.tenantId,
      actorId: 'system',
      action: 'enrollment.create',
      resourceType: 'enrollment',
      resourceId: id,
    });
    return rec;
  }

  transition(
    id: string,
    to: EnrollmentState,
    tenantCtx: TenantContext,
    actorId: string,
  ): EnrollmentRecord {
    const rec = this.get(id, tenantCtx);
    const allowed = TRANSITIONS[rec.state];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(rec.state, to);
    }
    rec.state = to;
    this.audit.append({
      tenantId: rec.tenantId,
      actorId,
      action: `enrollment.transition.${to}`,
      resourceType: 'enrollment',
      resourceId: id,
    });
    return rec;
  }

  get(id: string, tenantCtx: TenantContext): EnrollmentRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`enrollment ${id} not found`);
    assertBelongsToTenant(rec, tenantCtx);
    return rec;
  }
}
