/**
 * Tenant context — spec: specs/canonical/CORE-TENANT-ISOLATION.md
 * O contexto de tenant deriva SEMPRE da autenticação; nunca de input do usuário.
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
export interface TenantContext {
  readonly tenantId: string;
}
export class MissingTenantError extends Error {
  constructor() {
    if (stryMutAct_9fa48("131")) {
      {}
    } else {
      stryCov_9fa48("131");
      super(stryMutAct_9fa48("132") ? "" : (stryCov_9fa48("132"), 'tenant context is required'));
      this.name = stryMutAct_9fa48("133") ? "" : (stryCov_9fa48("133"), 'MissingTenantError');
    }
  }
}

/** Deriva o contexto de tenant a partir da sessão autenticada. */
export function tenantFromSession(session: {
  tenantId?: string;
} | null): TenantContext {
  if (stryMutAct_9fa48("134")) {
    {}
  } else {
    stryCov_9fa48("134");
    if (stryMutAct_9fa48("137") ? !session && !session.tenantId : stryMutAct_9fa48("136") ? false : stryMutAct_9fa48("135") ? true : (stryCov_9fa48("135", "136", "137"), (stryMutAct_9fa48("138") ? session : (stryCov_9fa48("138"), !session)) || (stryMutAct_9fa48("139") ? session.tenantId : (stryCov_9fa48("139"), !session.tenantId)))) if (stryMutAct_9fa48("140")) {
      ;
    } else {
      stryCov_9fa48("140");
      throw new MissingTenantError();
    }
    return stryMutAct_9fa48("141") ? {} : (stryCov_9fa48("141"), {
      tenantId: session.tenantId
    });
  }
}

/** Verifica que um registro pertence ao tenant corrente (defesa em profundidade). */
export function assertBelongsToTenant(record: {
  tenantId: string;
}, ctx: TenantContext): void {
  if (stryMutAct_9fa48("142")) {
    {}
  } else {
    stryCov_9fa48("142");
    if (stryMutAct_9fa48("145") ? record.tenantId === ctx.tenantId : stryMutAct_9fa48("144") ? false : stryMutAct_9fa48("143") ? true : (stryCov_9fa48("143", "144", "145"), record.tenantId !== ctx.tenantId)) {
      if (stryMutAct_9fa48("146")) {
        {}
      } else {
        stryCov_9fa48("146");
        if (stryMutAct_9fa48("147")) {
          ;
        } else {
          stryCov_9fa48("147");
          throw new TenantIsolationViolationError(ctx.tenantId, record.tenantId);
        }
      }
    }
  }
}
export class TenantIsolationViolationError extends Error {
  constructor(currentTenant: string, recordTenant: string) {
    if (stryMutAct_9fa48("148")) {
      {}
    } else {
      stryCov_9fa48("148");
      super(stryMutAct_9fa48("149") ? `` : (stryCov_9fa48("149"), `cross-tenant access denied (ctx=${currentTenant}, record=${recordTenant})`));
      this.name = stryMutAct_9fa48("150") ? "" : (stryCov_9fa48("150"), 'TenantIsolationViolationError');
    }
  }
}

/** Consulta genérica com escopo obrigatório de tenant. */
export function scopedQuery<T extends {
  tenantId: string;
}>(rows: readonly T[], ctx: TenantContext): T[] {
  if (stryMutAct_9fa48("151")) {
    {}
  } else {
    stryCov_9fa48("151");
    return stryMutAct_9fa48("152") ? rows : (stryCov_9fa48("152"), rows.filter(stryMutAct_9fa48("153") ? () => undefined : (stryCov_9fa48("153"), r => stryMutAct_9fa48("156") ? r.tenantId !== ctx.tenantId : stryMutAct_9fa48("155") ? false : stryMutAct_9fa48("154") ? true : (stryCov_9fa48("154", "155", "156"), r.tenantId === ctx.tenantId))));
  }
}