/**
 * Enrollment — spec: specs/canonical/EDU-ENROLLMENT.md
 * State machine + idempotency key + tenant invariant + audit.
 */
// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import type { TenantContext } from '@erp/core/src/tenancy.js';
import { assertBelongsToTenant } from '@erp/core/src/tenancy.js';
import { AuditStore } from '@erp/core/src/audit.js';
export type EnrollmentState = 'DRAFT' | 'PENDING_DOCUMENTS' | 'PENDING_APPROVAL' | 'ACTIVE' | 'COMPLETED' | 'CANCELED' | 'REJECTED';
const TRANSITIONS: Record<EnrollmentState, readonly EnrollmentState[]> = stryMutAct_9fa48("0") ? {} : (stryCov_9fa48("0"), {
  DRAFT: stryMutAct_9fa48("1") ? [] : (stryCov_9fa48("1"), [stryMutAct_9fa48("2") ? "" : (stryCov_9fa48("2"), 'PENDING_DOCUMENTS'), stryMutAct_9fa48("3") ? "" : (stryCov_9fa48("3"), 'CANCELED'), stryMutAct_9fa48("4") ? "" : (stryCov_9fa48("4"), 'REJECTED')]),
  PENDING_DOCUMENTS: stryMutAct_9fa48("5") ? [] : (stryCov_9fa48("5"), [stryMutAct_9fa48("6") ? "" : (stryCov_9fa48("6"), 'PENDING_APPROVAL'), stryMutAct_9fa48("7") ? "" : (stryCov_9fa48("7"), 'CANCELED')]),
  PENDING_APPROVAL: stryMutAct_9fa48("8") ? [] : (stryCov_9fa48("8"), [stryMutAct_9fa48("9") ? "" : (stryCov_9fa48("9"), 'ACTIVE'), stryMutAct_9fa48("10") ? "" : (stryCov_9fa48("10"), 'CANCELED'), stryMutAct_9fa48("11") ? "" : (stryCov_9fa48("11"), 'REJECTED')]),
  ACTIVE: stryMutAct_9fa48("12") ? [] : (stryCov_9fa48("12"), [stryMutAct_9fa48("13") ? "" : (stryCov_9fa48("13"), 'COMPLETED'), stryMutAct_9fa48("14") ? "" : (stryCov_9fa48("14"), 'CANCELED')]),
  COMPLETED: stryMutAct_9fa48("15") ? ["Stryker was here"] : (stryCov_9fa48("15"), []),
  CANCELED: stryMutAct_9fa48("16") ? ["Stryker was here"] : (stryCov_9fa48("16"), []),
  REJECTED: stryMutAct_9fa48("17") ? ["Stryker was here"] : (stryCov_9fa48("17"), [])
});
export class InvalidTransitionError extends Error {
  constructor(from: EnrollmentState, to: EnrollmentState) {
    if (stryMutAct_9fa48("18")) {
      {}
    } else {
      stryCov_9fa48("18");
      super(stryMutAct_9fa48("19") ? `` : (stryCov_9fa48("19"), `invalid enrollment transition ${from} -> ${to}`));
      this.name = stryMutAct_9fa48("20") ? "" : (stryCov_9fa48("20"), 'InvalidTransitionError');
    }
  }
}
export interface EnrollmentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly offerId: string;
  state: EnrollmentState;
}
export type EnrollmentCommand = {
  idempotencyKey: string;
  tenantCtx: TenantContext;
  studentId: string;
  offerId: string;
};
export type ConflictError = Error & {
  readonly name: 'IdempotencyConflictError';
};
export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    if (stryMutAct_9fa48("21")) {
      {}
    } else {
      stryCov_9fa48("21");
      super(stryMutAct_9fa48("22") ? `` : (stryCov_9fa48("22"), `idempotency key ${key} reused with different payload`));
      this.name = stryMutAct_9fa48("23") ? "" : (stryCov_9fa48("23"), 'IdempotencyConflictError');
    }
  }
}
export class EnrollmentService {
  private readonly records = new Map<string, EnrollmentRecord>();
  /** key -> { fingerprint, result } — idempotência de criação. */
  private readonly idempotency = new Map<string, {
    fingerprint: string;
    enrollmentId: string;
  }>();
  private nextId = 1;
  constructor(private readonly audit: AuditStore) {}

  /**
   * Cria matrícula com idempotência:
   * - mesma key + payload compatível → retorna a matrícula original (sem criar 2ª)
   * - mesma key + payload diferente → IdempotencyConflictError
   */
  enroll(cmd: EnrollmentCommand): EnrollmentRecord {
    if (stryMutAct_9fa48("24")) {
      {}
    } else {
      stryCov_9fa48("24");
      const fingerprint = JSON.stringify(stryMutAct_9fa48("25") ? [] : (stryCov_9fa48("25"), [cmd.tenantCtx.tenantId, cmd.studentId, cmd.offerId]));
      const previous = this.idempotency.get(cmd.idempotencyKey);
      if (stryMutAct_9fa48("27") ? false : stryMutAct_9fa48("26") ? true : (stryCov_9fa48("26", "27"), previous)) {
        if (stryMutAct_9fa48("28")) {
          {}
        } else {
          stryCov_9fa48("28");
          if (stryMutAct_9fa48("31") ? previous.fingerprint === fingerprint : stryMutAct_9fa48("30") ? false : stryMutAct_9fa48("29") ? true : (stryCov_9fa48("29", "30", "31"), previous.fingerprint !== fingerprint)) {
            if (stryMutAct_9fa48("32")) {
              {}
            } else {
              stryCov_9fa48("32");
              if (stryMutAct_9fa48("33")) {
                ;
              } else {
                stryCov_9fa48("33");
                throw new IdempotencyConflictError(cmd.idempotencyKey);
              }
            }
          }
          return this.records.get(previous.enrollmentId)!;
        }
      }

      // invariante: aluno e oferta pertencem ao tenant do operador
      const student: {
        tenantId: string;
      } = stryMutAct_9fa48("34") ? {} : (stryCov_9fa48("34"), {
        tenantId: cmd.tenantCtx.tenantId
      });
      if (stryMutAct_9fa48("35")) {
        ;
      } else {
        stryCov_9fa48("35");
        assertBelongsToTenant(student, cmd.tenantCtx);
      }
      const id = stryMutAct_9fa48("36") ? `` : (stryCov_9fa48("36"), `enr-${stryMutAct_9fa48("37") ? this.nextId-- : (stryCov_9fa48("37"), this.nextId++)}`);
      const rec: EnrollmentRecord = stryMutAct_9fa48("38") ? {} : (stryCov_9fa48("38"), {
        id,
        tenantId: cmd.tenantCtx.tenantId,
        studentId: cmd.studentId,
        offerId: cmd.offerId,
        state: stryMutAct_9fa48("39") ? "" : (stryCov_9fa48("39"), 'DRAFT')
      });
      if (stryMutAct_9fa48("40")) {
        ;
      } else {
        stryCov_9fa48("40");
        this.records.set(id, rec);
      }
      this.idempotency.set(cmd.idempotencyKey, stryMutAct_9fa48("42") ? {} : (stryCov_9fa48("42"), {
        fingerprint,
        enrollmentId: id
      }));
      this.audit.append(stryMutAct_9fa48("44") ? {} : (stryCov_9fa48("44"), {
        tenantId: rec.tenantId,
        actorId: stryMutAct_9fa48("45") ? "" : (stryCov_9fa48("45"), 'system'),
        action: stryMutAct_9fa48("46") ? "" : (stryCov_9fa48("46"), 'enrollment.create'),
        resourceType: stryMutAct_9fa48("47") ? "" : (stryCov_9fa48("47"), 'enrollment'),
        resourceId: id
      }));
      return rec;
    }
  }
  transition(id: string, to: EnrollmentState, tenantCtx: TenantContext, actorId: string): EnrollmentRecord {
    if (stryMutAct_9fa48("48")) {
      {}
    } else {
      stryCov_9fa48("48");
      const rec = this.get(id, tenantCtx);
      const allowed = TRANSITIONS[rec.state];
      if (stryMutAct_9fa48("51") ? false : stryMutAct_9fa48("50") ? true : stryMutAct_9fa48("49") ? allowed.includes(to) : (stryCov_9fa48("49", "50", "51"), !allowed.includes(to))) {
        if (stryMutAct_9fa48("52")) {
          {}
        } else {
          stryCov_9fa48("52");
          if (stryMutAct_9fa48("53")) {
            ;
          } else {
            stryCov_9fa48("53");
            throw new InvalidTransitionError(rec.state, to);
          }
        }
      }
      rec.state = to;
      this.audit.append(stryMutAct_9fa48("55") ? {} : (stryCov_9fa48("55"), {
        tenantId: rec.tenantId,
        actorId,
        action: stryMutAct_9fa48("56") ? `` : (stryCov_9fa48("56"), `enrollment.transition.${to}`),
        resourceType: stryMutAct_9fa48("57") ? "" : (stryCov_9fa48("57"), 'enrollment'),
        resourceId: id
      }));
      return rec;
    }
  }
  get(id: string, tenantCtx: TenantContext): EnrollmentRecord {
    if (stryMutAct_9fa48("58")) {
      {}
    } else {
      stryCov_9fa48("58");
      const rec = this.records.get(id);
      if (stryMutAct_9fa48("61") ? false : stryMutAct_9fa48("60") ? true : stryMutAct_9fa48("59") ? rec : (stryCov_9fa48("59", "60", "61"), !rec)) throw new Error(stryMutAct_9fa48("63") ? `` : (stryCov_9fa48("63"), `enrollment ${id} not found`));
      if (stryMutAct_9fa48("64")) {
        ;
      } else {
        stryCov_9fa48("64");
        assertBelongsToTenant(rec, tenantCtx);
      }
      return rec;
    }
  }
}