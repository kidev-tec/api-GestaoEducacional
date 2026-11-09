/**
 * Finance ledger — spec: specs/canonical/FINANCE-IDEMPOTENCY.md
 * Centavos inteiros (nunca float), append-only, idempotência, reversão vinculada.
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
import { AuditStore } from '@erp/core/src/audit.js';

/** Valor monetário em centavos inteiros. Fabricação via this, proibindo float. */
export class Money {
  private constructor(readonly cents: number) {
    if (stryMutAct_9fa48("65")) {
      {}
    } else {
      stryCov_9fa48("65");
      if (stryMutAct_9fa48("68") ? false : stryMutAct_9fa48("67") ? true : stryMutAct_9fa48("66") ? Number.isInteger(cents) : (stryCov_9fa48("66", "67", "68"), !Number.isInteger(cents))) {
        if (stryMutAct_9fa48("69")) {
          {}
        } else {
          stryCov_9fa48("69");
          throw new Error(stryMutAct_9fa48("71") ? `` : (stryCov_9fa48("71"), `Money must be integer cents, got ${cents}`));
        }
      }
    }
  }
  static fromCents(cents: number): Money {
    if (stryMutAct_9fa48("72")) {
      {}
    } else {
      stryCov_9fa48("72");
      return new Money(cents);
    }
  }
  /** Proibido: criar Money a partir de float não inteiro. */
  static fromFloat(value: number): never {
    if (stryMutAct_9fa48("73")) {
      {}
    } else {
      stryCov_9fa48("73");
      throw new Error(stryMutAct_9fa48("75") ? "" : (stryCov_9fa48("75"), 'float money is forbidden; use integer cents'));
    }
  }
  add(other: Money): Money {
    if (stryMutAct_9fa48("76")) {
      {}
    } else {
      stryCov_9fa48("76");
      return new Money(stryMutAct_9fa48("77") ? this.cents - other.cents : (stryCov_9fa48("77"), this.cents + other.cents));
    }
  }
  negate(): Money {
    if (stryMutAct_9fa48("78")) {
      {}
    } else {
      stryCov_9fa48("78");
      return new Money(stryMutAct_9fa48("79") ? +this.cents : (stryCov_9fa48("79"), -this.cents));
    }
  }
}
export type LedgerEntryType = 'CHARGE' | 'PAYMENT' | 'REVERSAL';
export interface LedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly type: LedgerEntryType;
  /** CHARGE/PAYMENT: valor do movimento. REVERSAL: valor negativo vinculado. */
  readonly amountCents: number;
  /** REVERSAL: id do lançamento original. Obrigatório para REVERSAL. */
  readonly reverses?: string;
  readonly idempotencyKey?: string;
}
export class ReversalWithoutOriginError extends Error {
  constructor() {
    if (stryMutAct_9fa48("80")) {
      {}
    } else {
      stryCov_9fa48("80");
      super(stryMutAct_9fa48("81") ? "" : (stryCov_9fa48("81"), 'reversal must reference the original entry'));
      this.name = stryMutAct_9fa48("82") ? "" : (stryCov_9fa48("82"), 'ReversalWithoutOriginError');
    }
  }
}
export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    if (stryMutAct_9fa48("83")) {
      {}
    } else {
      stryCov_9fa48("83");
      super(stryMutAct_9fa48("84") ? `` : (stryCov_9fa48("84"), `idempotency key ${key} reused with different payload`));
      this.name = stryMutAct_9fa48("85") ? "" : (stryCov_9fa48("85"), 'IdempotencyConflictError');
    }
  }
}
export class Ledger {
  private entries: LedgerEntry[] = stryMutAct_9fa48("86") ? ["Stryker was here"] : (stryCov_9fa48("86"), []);
  private nextId = 1;
  private readonly idempotency = new Map<string, {
    fingerprint: string;
    entryId: string;
  }>();
  constructor(private readonly audit: AuditStore) {}

  /**
   * Lança entrada append-only. Idempotente por key:
   * mesma key + mesmo payload → retorna original; payload diferente → conflito.
   */
  post(type: LedgerEntryType, amountCents: number, tenantCtx: TenantContext, opts: {
    idempotencyKey?: string;
    reverses?: string;
  } = {}): LedgerEntry {
    if (stryMutAct_9fa48("87")) {
      {}
    } else {
      stryCov_9fa48("87");
      const amount = Money.fromCents(amountCents); // rejeita float na porta
      if (stryMutAct_9fa48("90") ? type === 'REVERSAL' || !opts.reverses : stryMutAct_9fa48("89") ? false : stryMutAct_9fa48("88") ? true : (stryCov_9fa48("88", "89", "90"), (stryMutAct_9fa48("92") ? type !== 'REVERSAL' : stryMutAct_9fa48("91") ? true : (stryCov_9fa48("91", "92"), type === (stryMutAct_9fa48("93") ? "" : (stryCov_9fa48("93"), 'REVERSAL')))) && (stryMutAct_9fa48("94") ? opts.reverses : (stryCov_9fa48("94"), !opts.reverses)))) {
        if (stryMutAct_9fa48("95")) {
          {}
        } else {
          stryCov_9fa48("95");
          if (stryMutAct_9fa48("96")) {
            ;
          } else {
            stryCov_9fa48("96");
            throw new ReversalWithoutOriginError();
          }
        }
      }
      if (stryMutAct_9fa48("98") ? false : stryMutAct_9fa48("97") ? true : (stryCov_9fa48("97", "98"), opts.reverses)) {
        if (stryMutAct_9fa48("99")) {
          {}
        } else {
          stryCov_9fa48("99");
          const original = this.entries.find(stryMutAct_9fa48("100") ? () => undefined : (stryCov_9fa48("100"), e => stryMutAct_9fa48("103") ? e.id !== opts.reverses : stryMutAct_9fa48("102") ? false : stryMutAct_9fa48("101") ? true : (stryCov_9fa48("101", "102", "103"), e.id === opts.reverses)));
          if (stryMutAct_9fa48("106") ? !original && original.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("105") ? false : stryMutAct_9fa48("104") ? true : (stryCov_9fa48("104", "105", "106"), (stryMutAct_9fa48("107") ? original : (stryCov_9fa48("107"), !original)) || (stryMutAct_9fa48("109") ? original.tenantId === tenantCtx.tenantId : stryMutAct_9fa48("108") ? false : (stryCov_9fa48("108", "109"), original.tenantId !== tenantCtx.tenantId)))) {
            if (stryMutAct_9fa48("110")) {
              {}
            } else {
              stryCov_9fa48("110");
              // original inexistente ou de outro tenant: sem vazamento de existência
              if (stryMutAct_9fa48("111")) {
                ;
              } else {
                stryCov_9fa48("111");
                throw new ReversalWithoutOriginError();
              }
            }
          }
          // reversão explicita vínculo com valor oposto do original
          if (stryMutAct_9fa48("114") ? amount.cents === -original.amountCents : stryMutAct_9fa48("113") ? false : stryMutAct_9fa48("112") ? true : (stryCov_9fa48("112", "113", "114"), amount.cents !== (stryMutAct_9fa48("115") ? +original.amountCents : (stryCov_9fa48("115"), -original.amountCents)))) {
            if (stryMutAct_9fa48("116")) {
              {}
            } else {
              stryCov_9fa48("116");
              throw new Error(stryMutAct_9fa48("118") ? "" : (stryCov_9fa48("118"), 'reversal amount must exactly negate the original entry'));
            }
          }
        }
      }
      const fingerprint = JSON.stringify(stryMutAct_9fa48("119") ? [] : (stryCov_9fa48("119"), [type, amountCents, stryMutAct_9fa48("120") ? opts.reverses && null : (stryCov_9fa48("120"), opts.reverses ?? null)]));
      if (stryMutAct_9fa48("122") ? false : stryMutAct_9fa48("121") ? true : (stryCov_9fa48("121", "122"), opts.idempotencyKey)) {
        if (stryMutAct_9fa48("123")) {
          {}
        } else {
          stryCov_9fa48("123");
          const previous = this.idempotency.get(opts.idempotencyKey);
          if (stryMutAct_9fa48("125") ? false : stryMutAct_9fa48("124") ? true : (stryCov_9fa48("124", "125"), previous)) {
            if (stryMutAct_9fa48("126")) {
              {}
            } else {
              stryCov_9fa48("126");
              if (stryMutAct_9fa48("129") ? previous.fingerprint === fingerprint : stryMutAct_9fa48("128") ? false : stryMutAct_9fa48("127") ? true : (stryCov_9fa48("127", "128", "129"), previous.fingerprint !== fingerprint)) {
                if (stryMutAct_9fa48("130")) {
                  {}
                } else {
                  stryCov_9fa48("130");
                  if (stryMutAct_9fa48("131")) {
                    ;
                  } else {
                    stryCov_9fa48("131");
                    throw new IdempotencyConflictError(opts.idempotencyKey);
                  }
                }
              }
              return this.entries.find(stryMutAct_9fa48("132") ? () => undefined : (stryCov_9fa48("132"), e => stryMutAct_9fa48("135") ? e.id !== previous.entryId : stryMutAct_9fa48("134") ? false : stryMutAct_9fa48("133") ? true : (stryCov_9fa48("133", "134", "135"), e.id === previous.entryId)))!;
            }
          }
        }
      }
      const entry: LedgerEntry = Object.freeze(stryMutAct_9fa48("136") ? {} : (stryCov_9fa48("136"), {
        id: stryMutAct_9fa48("137") ? `` : (stryCov_9fa48("137"), `led-${stryMutAct_9fa48("138") ? this.nextId-- : (stryCov_9fa48("138"), this.nextId++)}`),
        tenantId: tenantCtx.tenantId,
        type,
        amountCents: amount.cents,
        reverses: opts.reverses,
        idempotencyKey: opts.idempotencyKey
      }));
      if (stryMutAct_9fa48("139")) {
        ;
      } else {
        stryCov_9fa48("139");
        this.entries.push(entry);
      }
      if (stryMutAct_9fa48("141") ? false : stryMutAct_9fa48("140") ? true : (stryCov_9fa48("140", "141"), opts.idempotencyKey)) {
        if (stryMutAct_9fa48("142")) {
          {}
        } else {
          stryCov_9fa48("142");
          this.idempotency.set(opts.idempotencyKey, stryMutAct_9fa48("144") ? {} : (stryCov_9fa48("144"), {
            fingerprint,
            entryId: entry.id
          }));
        }
      }
      this.audit.append(stryMutAct_9fa48("146") ? {} : (stryCov_9fa48("146"), {
        tenantId: tenantCtx.tenantId,
        actorId: stryMutAct_9fa48("147") ? "" : (stryCov_9fa48("147"), 'system'),
        action: stryMutAct_9fa48("148") ? `` : (stryCov_9fa48("148"), `ledger.${stryMutAct_9fa48("149") ? type.toUpperCase() : (stryCov_9fa48("149"), type.toLowerCase())}`),
        resourceType: stryMutAct_9fa48("150") ? "" : (stryCov_9fa48("150"), 'ledger-entry'),
        resourceId: entry.id
      }));
      return entry;
    }
  }

  /** Saldo consolidado do tenant (centavos inteiros). */
  balance(tenantCtx: TenantContext): number {
    if (stryMutAct_9fa48("151")) {
      {}
    } else {
      stryCov_9fa48("151");
      return stryMutAct_9fa48("152") ? this.entries.reduce((sum, e) => sum + e.amountCents, 0) : (stryCov_9fa48("152"), this.entries.filter(stryMutAct_9fa48("153") ? () => undefined : (stryCov_9fa48("153"), e => stryMutAct_9fa48("156") ? e.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("155") ? false : stryMutAct_9fa48("154") ? true : (stryCov_9fa48("154", "155", "156"), e.tenantId === tenantCtx.tenantId))).reduce(stryMutAct_9fa48("157") ? () => undefined : (stryCov_9fa48("157"), (sum, e) => stryMutAct_9fa48("158") ? sum - e.amountCents : (stryCov_9fa48("158"), sum + e.amountCents)), 0));
    }
  }

  /** Leitura escopada; entries são frozen (append-only). */
  list(tenantCtx: TenantContext): readonly LedgerEntry[] {
    if (stryMutAct_9fa48("159")) {
      {}
    } else {
      stryCov_9fa48("159");
      return stryMutAct_9fa48("160") ? this.entries : (stryCov_9fa48("160"), this.entries.filter(stryMutAct_9fa48("161") ? () => undefined : (stryCov_9fa48("161"), e => stryMutAct_9fa48("164") ? e.tenantId !== tenantCtx.tenantId : stryMutAct_9fa48("163") ? false : stryMutAct_9fa48("162") ? true : (stryCov_9fa48("162", "163", "164"), e.tenantId === tenantCtx.tenantId))));
    }
  }
  count(): number {
    if (stryMutAct_9fa48("165")) {
      {}
    } else {
      stryCov_9fa48("165");
      return this.entries.length;
    }
  }
}