/**
 * Audit trail append-only, sem PII exposta (invariante ARCHITECTURE.md §5).
 */
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
  private records: AuditRecord[] = [];
  private nextSeq = 1;

  append(rec: Omit<AuditRecord, 'seq' | 'at'> & { at?: string }): Readonly<AuditRecord> {
    const stored: AuditRecord = Object.freeze({
      seq: this.nextSeq++,
      at: rec.at ?? new Date().toISOString(),
      correlationId: rec.correlationId,
      tenantId: rec.tenantId,
      actorId: rec.actorId,
      action: rec.action,
      resourceType: rec.resourceType,
      resourceId: rec.resourceId,
    });
    this.records.push(stored);
    return stored;
  }

  /** Leitura sempre escopada ao tenant; records são frozen (imutáveis). */
  list(tenantCtx: { tenantId: string }): readonly AuditRecord[] {
    return this.records.filter((r) => r.tenantId === tenantCtx.tenantId);
  }

  /** Integridade: any mutação de record em lugar algum é possível — frozen. */
  count(): number {
    return this.records.length;
  }
}

/** Redação de PII em payloads de auditoria. */
export function redactPii<T extends Record<string, unknown>>(payload: T): T {
  const piiKeys = ['cpf', 'email', 'phone', 'nome', 'name', 'address', 'telefone'];
  const out = { ...payload };
  for (const k of Object.keys(out)) {
    if (piiKeys.includes(k.toLowerCase())) out[k] = '[REDACTED]' as never;
  }
  return out;
}
