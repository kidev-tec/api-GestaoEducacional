/**
 * Audit trail append-only, sem PII exposta (invariante ARCHITECTURE.md §5).
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
export interface AuditRecord {
  readonly seq: number;
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly at: string;
  readonly correlationId?: string;
}
export class AuditStore {
  private records: AuditRecord[] = stryMutAct_9fa48("0") ? ["Stryker was here"] : (stryCov_9fa48("0"), []);
  private nextSeq = 1;
  append(rec: Omit<AuditRecord, 'seq' | 'at'> & {
    at?: string;
  }): Readonly<AuditRecord> {
    if (stryMutAct_9fa48("1")) {
      {}
    } else {
      stryCov_9fa48("1");
      const stored: AuditRecord = Object.freeze(stryMutAct_9fa48("2") ? {} : (stryCov_9fa48("2"), {
        seq: stryMutAct_9fa48("3") ? this.nextSeq-- : (stryCov_9fa48("3"), this.nextSeq++),
        at: stryMutAct_9fa48("4") ? rec.at && new Date().toISOString() : (stryCov_9fa48("4"), rec.at ?? new Date().toISOString()),
        correlationId: rec.correlationId,
        tenantId: rec.tenantId,
        actorId: rec.actorId,
        action: rec.action,
        resourceType: rec.resourceType,
        resourceId: rec.resourceId
      }));
      if (stryMutAct_9fa48("5")) {
        ;
      } else {
        stryCov_9fa48("5");
        this.records.push(stored);
      }
      return stored;
    }
  }

  /** Leitura sempre escopada ao tenant; records são frozen (imutáveis). */
  list(tenantCtx: {
    tenantId: string;
  }): readonly AuditRecord[] {
    if (stryMutAct_9fa48("6")) {
      {}
    } else {
      stryCov_9fa48("6");
      return stryMutAct_9fa48("7") ? this.records : (stryCov_9fa48("7"), this.records.filter(stryMutAct_9fa48("8") ? () => undefined : (stryCov_9fa48("8"), r => stryMutAct_9fa48("11") ? r.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("10") ? false : stryMutAct_9fa48("9") ? true : (stryCov_9fa48("9", "10", "11"), r.tenantId === tenantCtx.tenantId))));
    }
  }

  /** Integridade: any mutação de record em lugar algum é possível — frozen. */
  count(): number {
    if (stryMutAct_9fa48("12")) {
      {}
    } else {
      stryCov_9fa48("12");
      return this.records.length;
    }
  }
}

/** Redação de PII em payloads de auditoria. */
export function redactPii<T extends Record<string, unknown>>(payload: T): T {
  if (stryMutAct_9fa48("13")) {
    {}
  } else {
    stryCov_9fa48("13");
    const piiKeys = stryMutAct_9fa48("14") ? [] : (stryCov_9fa48("14"), [stryMutAct_9fa48("15") ? "" : (stryCov_9fa48("15"), 'cpf'), stryMutAct_9fa48("16") ? "" : (stryCov_9fa48("16"), 'email'), stryMutAct_9fa48("17") ? "" : (stryCov_9fa48("17"), 'phone'), stryMutAct_9fa48("18") ? "" : (stryCov_9fa48("18"), 'nome'), stryMutAct_9fa48("19") ? "" : (stryCov_9fa48("19"), 'name'), stryMutAct_9fa48("20") ? "" : (stryCov_9fa48("20"), 'address'), stryMutAct_9fa48("21") ? "" : (stryCov_9fa48("21"), 'telefone')]);
    const out = stryMutAct_9fa48("22") ? {} : (stryCov_9fa48("22"), {
      ...payload
    });
    for (const k of Object.keys(out)) {
      if (stryMutAct_9fa48("23")) {
        {}
      } else {
        stryCov_9fa48("23");
        if (stryMutAct_9fa48("25") ? false : stryMutAct_9fa48("24") ? true : (stryCov_9fa48("24", "25"), piiKeys.includes(stryMutAct_9fa48("26") ? k.toUpperCase() : (stryCov_9fa48("26"), k.toLowerCase())))) out[k] = '[REDACTED]' as never;
      }
    }
    return out;
  }
}