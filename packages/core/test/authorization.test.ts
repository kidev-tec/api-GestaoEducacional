import { describe, it, expect } from 'vitest';
import {
  AuthorizationService,
  ForbiddenError,
  type Actor,
  type Resource,
  type PermissionRule,
} from '../src/authorization.js';

const rules: PermissionRule[] = [
  { role: 'secretaria', action: 'read', resource: 'student' },
  { role: 'secretaria', action: 'write', resource: 'student' },
  { role: 'direcao', action: 'manage', resource: 'student' },
  { role: 'financeiro', action: 'read', resource: 'invoice' },
];

const service = new AuthorizationService(rules);

const actor = (id: string, tenantId: string, roles: string[]): Actor => ({
  id,
  tenantId,
  roles,
});
const res = (tenantId: string, type = 'student'): Resource => ({ tenantId, type });
const ctx = { tenantId: 't1' };

describe('authorization', () => {
  it('allows role with permission in same tenant', () => {
    expect(() =>
      service.authorize(actor('a1', 't1', ['secretaria']), 'read', res('t1'), ctx),
    ).not.toThrow();
  });

  it('denies role without permission', () => {
    expect(() =>
      service.authorize(actor('a2', 't1', ['docente']), 'write', res('t1'), ctx),
    ).toThrow(ForbiddenError);
  });

  it('denies action not granted to any rule for resource', () => {
    expect(() =>
      service.authorize(actor('a3', 't1', ['secretaria']), 'delete', res('t1'), ctx),
    ).toThrow(ForbiddenError);
  });

  it('denies actor from another tenant even with same role', () => {
    expect(() =>
      service.authorize(actor('a4', 't2', ['secretaria']), 'read', res('t1'), ctx),
    ).toThrow(ForbiddenError);
  });

  it('denies resource from another tenant', () => {
    expect(() =>
      service.authorize(actor('a5', 't1', ['secretaria']), 'read', res('t2'), ctx),
    ).toThrow(ForbiddenError);
  });

  it('multiple roles: any match authorizes', () => {
    expect(() =>
      service.authorize(actor('a6', 't1', ['docente', 'direcao']), 'manage', res('t1'), ctx),
    ).not.toThrow();
  });
});

describe('authorization + entitlement', () => {
  it('denies when module disabled even with permission', () => {
    expect(() =>
      service.authorizeWithEntitlement(
        actor('a7', 't1', ['secretaria']),
        'read',
        res('t1'),
        ctx,
        false,
      ),
    ).toThrow(ForbiddenError);
  });

  it('allows when module enabled and permitted', () => {
    expect(() =>
      service.authorizeWithEntitlement(
        actor('a8', 't1', ['secretaria']),
        'read',
        res('t1'),
        ctx,
        true,
      ),
    ).not.toThrow();
  });

  it('denies when module enabled but role not permitted', () => {
    expect(() =>
      service.authorizeWithEntitlement(
        actor('a9', 't1', ['docente']),
        'read',
        res('t1'),
        ctx,
        true,
      ),
    ).toThrow(ForbiddenError);
  });
});
