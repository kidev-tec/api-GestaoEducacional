/**
 * Autorização server-side — matriz ator × ação × recurso × tenant.
 * Checagem no serviço, não no menu (AGENTS.md regra inegociável).
 */
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
    super(`actor=${actorId} denied ${action} on ${resourceType}`);
    this.name = 'ForbiddenError';
  }
}

export class AuthorizationService {
  constructor(private readonly rules: readonly PermissionRule[]) {}

  authorize(
    actor: Actor,
    action: Action,
    resource: Resource,
    tenantCtx: { tenantId: string },
  ): void {
    const allowedRoles = new Set(
      this.rules
        .filter((r) => r.action === action && r.resource === resource.type)
        .map((r) => r.role),
    );
    const permitted =
      actor.tenantId === tenantCtx.tenantId &&
      resource.tenantId === tenantCtx.tenantId &&
      actor.roles.some((role) => allowedRoles.has(role));
    if (!permitted) throw new ForbiddenError(actor.id, action, resource.type);
  }

  /** Entitlement: módulo desabilitado bloqueia acesso mesmo com permissão de role. */
  authorizeWithEntitlement(
    actor: Actor,
    action: Action,
    resource: Resource,
    tenantCtx: { tenantId: string },
    moduleEnabled: boolean,
  ): void {
    if (!moduleEnabled) {
      throw new ForbiddenError(actor.id, action, resource.type);
    }
    this.authorize(actor, action, resource, tenantCtx);
  }
}
