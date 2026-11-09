/**
 * Autorização server-side — matriz ator × ação × recurso × tenant.
 * Checagem no serviço, não no menu (AGENTS.md regra inegociável).
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
export interface Actor {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
}
export type Action = 'read' | 'write' | 'delete' | 'manage';
export interface PermissionRule {
  readonly role: string;
  readonly action: Action;
  readonly resource: string;
}
export interface Resource {
  readonly tenantId: string;
  readonly type: string;
}
export class ForbiddenError extends Error {
  constructor(actorId: string, action: Action, resourceType: string) {
    if (stryMutAct_9fa48("27")) {
      {}
    } else {
      stryCov_9fa48("27");
      super(stryMutAct_9fa48("28") ? `` : (stryCov_9fa48("28"), `actor=${actorId} denied ${action} on ${resourceType}`));
      this.name = stryMutAct_9fa48("29") ? "" : (stryCov_9fa48("29"), 'ForbiddenError');
    }
  }
}
export class AuthorizationService {
  constructor(private readonly rules: readonly PermissionRule[]) {}
  authorize(actor: Actor, action: Action, resource: Resource, tenantCtx: {
    tenantId: string;
  }): void {
    if (stryMutAct_9fa48("30")) {
      {}
    } else {
      stryCov_9fa48("30");
      const allowedRoles = new Set(stryMutAct_9fa48("31") ? this.rules.map(r => r.role) : (stryCov_9fa48("31"), this.rules.filter(stryMutAct_9fa48("32") ? () => undefined : (stryCov_9fa48("32"), r => stryMutAct_9fa48("35") ? r.action === action || r.resource === resource.type : stryMutAct_9fa48("34") ? false : stryMutAct_9fa48("33") ? true : (stryCov_9fa48("33", "34", "35"), (stryMutAct_9fa48("37") ? r.action !== action : stryMutAct_9fa48("36") ? true : (stryCov_9fa48("36", "37"), r.action === action)) && (stryMutAct_9fa48("39") ? r.resource !== resource.type : stryMutAct_9fa48("38") ? true : (stryCov_9fa48("38", "39"), r.resource === resource.type))))).map(stryMutAct_9fa48("40") ? () => undefined : (stryCov_9fa48("40"), r => r.role))));
      const permitted = stryMutAct_9fa48("43") ? actor.tenantId === tenantCtx.tenantId && resource.tenantId === tenantCtx.tenantId || actor.roles.some(role => allowedRoles.has(role)) : stryMutAct_9fa48("42") ? false : stryMutAct_9fa48("41") ? true : (stryCov_9fa48("41", "42", "43"), (stryMutAct_9fa48("45") ? actor.tenantId === tenantCtx.tenantId || resource.tenantId === tenantCtx.tenantId : stryMutAct_9fa48("44") ? true : (stryCov_9fa48("44", "45"), (stryMutAct_9fa48("47") ? actor.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("46") ? true : (stryCov_9fa48("46", "47"), actor.tenantId === tenantCtx.tenantId)) && (stryMutAct_9fa48("49") ? resource.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("48") ? true : (stryCov_9fa48("48", "49"), resource.tenantId === tenantCtx.tenantId)))) && (stryMutAct_9fa48("50") ? actor.roles.every(role => allowedRoles.has(role)) : (stryCov_9fa48("50"), actor.roles.some(stryMutAct_9fa48("51") ? () => undefined : (stryCov_9fa48("51"), role => allowedRoles.has(role))))));
      if (stryMutAct_9fa48("54") ? false : stryMutAct_9fa48("53") ? true : stryMutAct_9fa48("52") ? permitted : (stryCov_9fa48("52", "53", "54"), !permitted)) if (stryMutAct_9fa48("55")) {
        ;
      } else {
        stryCov_9fa48("55");
        throw new ForbiddenError(actor.id, action, resource.type);
      }
    }
  }

  /** Entitlement: módulo desabilitado bloqueia acesso mesmo com permissão de role. */
  authorizeWithEntitlement(actor: Actor, action: Action, resource: Resource, tenantCtx: {
    tenantId: string;
  }, moduleEnabled: boolean): void {
    if (stryMutAct_9fa48("56")) {
      {}
    } else {
      stryCov_9fa48("56");
      if (stryMutAct_9fa48("59") ? false : stryMutAct_9fa48("58") ? true : stryMutAct_9fa48("57") ? moduleEnabled : (stryCov_9fa48("57", "58", "59"), !moduleEnabled)) {
        if (stryMutAct_9fa48("60")) {
          {}
        } else {
          stryCov_9fa48("60");
          if (stryMutAct_9fa48("61")) {
            ;
          } else {
            stryCov_9fa48("61");
            throw new ForbiddenError(actor.id, action, resource.type);
          }
        }
      }
      if (stryMutAct_9fa48("62")) {
        ;
      } else {
        stryCov_9fa48("62");
        this.authorize(actor, action, resource, tenantCtx);
      }
    }
  }
}