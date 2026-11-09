/**
 * Outbox transacional + eventos versionados idempotentes
 * (ARCHITECTURE.md §4: at-least-once não pode duplicar efeito de negócio).
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
export interface OutboxEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly tenantId: string;
  readonly payload: T;
  readonly createdAt: string;
  processedAt: string | null;
}
export class Outbox {
  private events: OutboxEvent[] = stryMutAct_9fa48("85") ? ["Stryker was here"] : (stryCov_9fa48("85"), []);
  private processedIds = new Set<string>();

  /** Enfileira evento na MESMA transação da escrita de negócio (caller garante). */
  enqueue(id: string, type: string, version: string, tenantCtx: {
    tenantId: string;
  }, payload: unknown, now = new Date().toISOString()): Readonly<OutboxEvent> {
    if (stryMutAct_9fa48("86")) {
      {}
    } else {
      stryCov_9fa48("86");
      if (stryMutAct_9fa48("89") ? this.events.every(e => e.id === id) : stryMutAct_9fa48("88") ? false : stryMutAct_9fa48("87") ? true : (stryCov_9fa48("87", "88", "89"), this.events.some(stryMutAct_9fa48("90") ? () => undefined : (stryCov_9fa48("90"), e => stryMutAct_9fa48("93") ? e.id !== id : stryMutAct_9fa48("92") ? false : stryMutAct_9fa48("91") ? true : (stryCov_9fa48("91", "92", "93"), e.id === id))))) {
        if (stryMutAct_9fa48("94")) {
          {}
        } else {
          stryCov_9fa48("94");
          throw new Error(stryMutAct_9fa48("96") ? `` : (stryCov_9fa48("96"), `duplicate outbox id ${id}`));
        }
      }
      const ev: OutboxEvent = stryMutAct_9fa48("97") ? {} : (stryCov_9fa48("97"), {
        id,
        type,
        version,
        tenantId: tenantCtx.tenantId,
        payload: payload,
        createdAt: now,
        processedAt: null
      });
      if (stryMutAct_9fa48("98")) {
        ;
      } else {
        stryCov_9fa48("98");
        this.events.push(ev);
      }
      return ev;
    }
  }

  /**
   * Delivery at-least-once com deduplicação: reprocessar o mesmo id
   * NÃO executa o handler duas vezes (idempotência obrigatória).
   */
  process(handler: (ev: Readonly<OutboxEvent>) => void): {
    processed: number;
    skipped: number;
  } {
    if (stryMutAct_9fa48("99")) {
      {}
    } else {
      stryCov_9fa48("99");
      let processed = 0;
      let skipped = 0;
      for (const ev of this.events) {
        if (stryMutAct_9fa48("100")) {
          {}
        } else {
          stryCov_9fa48("100");
          if (stryMutAct_9fa48("103") ? ev.processedAt !== null && this.processedIds.has(ev.id) : stryMutAct_9fa48("102") ? false : stryMutAct_9fa48("101") ? true : (stryCov_9fa48("101", "102", "103"), (stryMutAct_9fa48("105") ? ev.processedAt === null : stryMutAct_9fa48("104") ? false : (stryCov_9fa48("104", "105"), ev.processedAt !== null)) || this.processedIds.has(ev.id))) {
            if (stryMutAct_9fa48("106")) {
              {}
            } else {
              stryCov_9fa48("106");
              stryMutAct_9fa48("107") ? skipped-- : (stryCov_9fa48("107"), skipped++);
              continue;
            }
          }
          if (stryMutAct_9fa48("108")) {
            ;
          } else {
            stryCov_9fa48("108");
            handler(ev);
          }
          ev.processedAt = new Date().toISOString();
          if (stryMutAct_9fa48("109")) {
            ;
          } else {
            stryCov_9fa48("109");
            this.processedIds.add(ev.id);
          }
          stryMutAct_9fa48("110") ? processed-- : (stryCov_9fa48("110"), processed++);
        }
      }
      return stryMutAct_9fa48("111") ? {} : (stryCov_9fa48("111"), {
        processed,
        skipped
      });
    }
  }
  pending(tenantCtx: {
    tenantId: string;
  }): readonly Readonly<OutboxEvent>[] {
    if (stryMutAct_9fa48("112")) {
      {}
    } else {
      stryCov_9fa48("112");
      return stryMutAct_9fa48("113") ? this.events : (stryCov_9fa48("113"), this.events.filter(stryMutAct_9fa48("114") ? () => undefined : (stryCov_9fa48("114"), e => stryMutAct_9fa48("117") ? e.tenantId === tenantCtx.tenantId || e.processedAt === null : stryMutAct_9fa48("116") ? false : stryMutAct_9fa48("115") ? true : (stryCov_9fa48("115", "116", "117"), (stryMutAct_9fa48("119") ? e.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("118") ? true : (stryCov_9fa48("118", "119"), e.tenantId === tenantCtx.tenantId)) && (stryMutAct_9fa48("121") ? e.processedAt !== null : stryMutAct_9fa48("120") ? true : (stryCov_9fa48("120", "121"), e.processedAt === null))))));
    }
  }
}

/** Handler idempotente de exemplo: efeito de negócio executado 1× por eventId. */
export class IdempotentEffectRunner {
  private applied = new Set<string>();
  readonly appliedEffects: string[] = stryMutAct_9fa48("122") ? ["Stryker was here"] : (stryCov_9fa48("122"), []);
  run(eventId: string, effect: string): boolean {
    if (stryMutAct_9fa48("123")) {
      {}
    } else {
      stryCov_9fa48("123");
      const key = stryMutAct_9fa48("124") ? `` : (stryCov_9fa48("124"), `${eventId}:${effect}`);
      if (stryMutAct_9fa48("126") ? false : stryMutAct_9fa48("125") ? true : (stryCov_9fa48("125", "126"), this.applied.has(key))) return stryMutAct_9fa48("127") ? true : (stryCov_9fa48("127"), false);
      if (stryMutAct_9fa48("128")) {
        ;
      } else {
        stryCov_9fa48("128");
        this.applied.add(key);
      }
      if (stryMutAct_9fa48("129")) {
        ;
      } else {
        stryCov_9fa48("129");
        this.appliedEffects.push(effect);
      }
      return stryMutAct_9fa48("130") ? false : (stryCov_9fa48("130"), true);
    }
  }
}