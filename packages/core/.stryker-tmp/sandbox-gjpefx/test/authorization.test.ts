// @ts-nocheck
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

const expectForbidden = (fn: () => void): ForbiddenError => {
  try {
    fn();
    throw new Error('expected ForbiddenError');
  } catch (e) {
    return e as ForbiddenError;
  }
};

describe('authorization', () => {
  it('allows role with permission in same tenant', () => {
    expect(() =>
      service.authorize(actor('a1', 't1', ['secretaria']), 'read', res('t1'), ctx),
    ).not.toThrow();
  });

  it('denies role without permission, named error with actor/action/resource', () => {
    const err = expectForbidden(() =>
      service.authorize(actor('a2', 't1', ['docente']), 'write', res('t1'), ctx),
    );
    expect(err.name).toBe('ForbiddenError');
    expect(err.message).toBe('actor=a2 denied write on student');
  });

  it('denies action not granted to any rule for resource', () => {
    const err = expectForbidden(() =>
      service.authorize(actor('a3', 't1', ['secretaria']), 'delete', res('t1'), ctx),
    );
    expect(err.message).toBe('actor=a3 denied delete on student');
  });

  it('denies actor from another tenant even with same role', () => {
    const err = expectForbidden(() =>
      service.authorize(actor('a4', 't2', ['secretaria']), 'read', res('t1'), ctx),
    );
    expect(err.message).toBe('actor=a4 denied read on student');
  });

  it('denies resource from another tenant', () => {
    expect(() =>
      service.authorize(actor('a5', 't1', ['secretaria']), 'read', res('t2'), ctx),
    ).toThrow(ForbiddenError);
  });

  it('filters rules by exact resource type (wrong-type permission does not leak)', () => {
    const err = expectForbidden(() =>
      service.authorize(actor('a5b', 't1', ['financeiro']), 'read', res('t1', 'student'), ctx),
    );
    // financeiro can read invoice, NOT student
    expect(err.message).toBe('actor=a5b denied read on student');
  });

  it('multiple roles: any match authorizes', () => {
    expect(() =>
      service.authorize(actor('a6', 't1', ['docente', 'direcao']), 'manage', res('t1'), ctx),
    ).not.toThrow();
  });
});

describe('authorization + entitlement', () => {
  it('denies when module disabled even with permission, named error', () => {
    const err = expectForbidden(() =>
      service.authorizeWithEntitlement(
        actor('a7', 't1', ['secretaria']),
        'read',
        res('t1'),
        ctx,
        false,
      ),
    );
    expect(err.name).toBe('ForbiddenError');
    expect(err.message).toBe('actor=a7 denied read on student');
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
