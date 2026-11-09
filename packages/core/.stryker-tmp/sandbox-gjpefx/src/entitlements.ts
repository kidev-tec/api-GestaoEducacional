/**
 * Entitlements de módulos por tenant — avaliados no serviço/API,
 * nunca só na interface (PLATFORM_STRATEGY.md regra 5).
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
export type ModuleName = 'crm' | 'enrollment' | 'academic' | 'finance' | 'billing' | 'audit';
export class ModuleCatalog {
  private enabled = new Map<string, Set<ModuleName>>();
  enable(tenantId: string, mod: ModuleName): void {
    if (stryMutAct_9fa48("63")) {
      {}
    } else {
      stryCov_9fa48("63");
      let set = this.enabled.get(tenantId);
      if (stryMutAct_9fa48("66") ? false : stryMutAct_9fa48("65") ? true : stryMutAct_9fa48("64") ? set : (stryCov_9fa48("64", "65", "66"), !set)) {
        if (stryMutAct_9fa48("67")) {
          {}
        } else {
          stryCov_9fa48("67");
          set = new Set();
          if (stryMutAct_9fa48("68")) {
            ;
          } else {
            stryCov_9fa48("68");
            this.enabled.set(tenantId, set);
          }
        }
      }
      if (stryMutAct_9fa48("69")) {
        ;
      } else {
        stryCov_9fa48("69");
        set.add(mod);
      }
    }
  }
  disable(tenantId: string, mod: ModuleName): void {
    if (stryMutAct_9fa48("70")) {
      {}
    } else {
      stryCov_9fa48("70");
      stryMutAct_9fa48("71") ? this.enabled.get(tenantId).delete(mod) : (stryCov_9fa48("71"), this.enabled.get(tenantId)?.delete(mod));
    }
  }
  isEnabled(tenantId: string, mod: ModuleName): boolean {
    if (stryMutAct_9fa48("72")) {
      {}
    } else {
      stryCov_9fa48("72");
      return stryMutAct_9fa48("73") ? this.enabled.get(tenantId)?.has(mod) && false : (stryCov_9fa48("73"), (stryMutAct_9fa48("74") ? this.enabled.get(tenantId).has(mod) : (stryCov_9fa48("74"), this.enabled.get(tenantId)?.has(mod))) ?? (stryMutAct_9fa48("75") ? true : (stryCov_9fa48("75"), false)));
    }
  }

  /** Porta única de decisão server-side. */
  require(tenantId: string, mod: ModuleName): void {
    if (stryMutAct_9fa48("76")) {
      {}
    } else {
      stryCov_9fa48("76");
      if (stryMutAct_9fa48("79") ? false : stryMutAct_9fa48("78") ? true : stryMutAct_9fa48("77") ? this.isEnabled(tenantId, mod) : (stryCov_9fa48("77", "78", "79"), !this.isEnabled(tenantId, mod))) {
        if (stryMutAct_9fa48("80")) {
          {}
        } else {
          stryCov_9fa48("80");
          if (stryMutAct_9fa48("81")) {
            ;
          } else {
            stryCov_9fa48("81");
            throw new ModuleNotEntitledError(tenantId, mod);
          }
        }
      }
    }
  }
}
export class ModuleNotEntitledError extends Error {
  constructor(tenantId: string, mod: ModuleName) {
    if (stryMutAct_9fa48("82")) {
      {}
    } else {
      stryCov_9fa48("82");
      super(stryMutAct_9fa48("83") ? `` : (stryCov_9fa48("83"), `module ${mod} not entitled for tenant ${tenantId}`));
      this.name = stryMutAct_9fa48("84") ? "" : (stryCov_9fa48("84"), 'ModuleNotEntitledError');
    }
  }
}