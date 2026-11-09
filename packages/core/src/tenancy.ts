/**
 * Tenant context — spec: specs/canonical/CORE-TENANT-ISOLATION.md
 * O contexto de tenant deriva SEMPRE da autenticação; nunca de input do usuário.
 */
export interface TenantContext {
  readonly tenantId: string;
}

export class MissingTenantError extends Error {
  constructor() {
    super('tenant context is required');
    this.name = 'MissingTenantError';
  }
}

/** Deriva o contexto de tenant a partir da sessão autenticada. */
export function tenantFromSession(session: { tenantId?: string } | null): TenantContext {
  if (!session || !session.tenantId) throw new MissingTenantError();
  return { tenantId: session.tenantId };
}

/** Verifica que um registro pertence ao tenant corrente (defesa em profundidade). */
export function assertBelongsToTenant(record: { tenantId: string }, ctx: TenantContext): void {
  if (record.tenantId !== ctx.tenantId) {
    throw new TenantIsolationViolationError(ctx.tenantId, record.tenantId);
  }
}

export class TenantIsolationViolationError extends Error {
  constructor(currentTenant: string, recordTenant: string) {
    super(`cross-tenant access denied (ctx=${currentTenant}, record=${recordTenant})`);
    this.name = 'TenantIsolationViolationError';
  }
}

/** Consulta genérica com escopo obrigatório de tenant. */
export function scopedQuery<T extends { tenantId: string }>(
  rows: readonly T[],
  ctx: TenantContext,
): T[] {
  return rows.filter((r) => r.tenantId === ctx.tenantId);
}
