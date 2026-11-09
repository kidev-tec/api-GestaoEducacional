/**
 * Entitlements de módulos por tenant — avaliados no serviço/API,
 * nunca só na interface (PLATFORM_STRATEGY.md regra 5).
 */
export type ModuleName =
  | 'crm'
  | 'enrollment'
  | 'academic'
  | 'finance'
  | 'billing'
  | 'audit';

export class ModuleCatalog {
  private enabled = new Map<string, Set<ModuleName>>();

  enable(tenantId: string, mod: ModuleName): void {
    let set = this.enabled.get(tenantId);
    if (!set) {
      set = new Set();
      this.enabled.set(tenantId, set);
    }
    set.add(mod);
  }

  disable(tenantId: string, mod: ModuleName): void {
    this.enabled.get(tenantId)?.delete(mod);
  }

  isEnabled(tenantId: string, mod: ModuleName): boolean {
    return this.enabled.get(tenantId)?.has(mod) ?? false;
  }

  /** Porta única de decisão server-side. */
  require(tenantId: string, mod: ModuleName): void {
    if (!this.isEnabled(tenantId, mod)) {
      throw new ModuleNotEntitledError(tenantId, mod);
    }
  }
}

export class ModuleNotEntitledError extends Error {
  constructor(tenantId: string, mod: ModuleName) {
    super(`module ${mod} not entitled for tenant ${tenantId}`);
    this.name = 'ModuleNotEntitledError';
  }
}
