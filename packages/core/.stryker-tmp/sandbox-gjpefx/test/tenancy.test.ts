// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  tenantFromSession,
  assertBelongsToTenant,
  scopedQuery,
  MissingTenantError,
  TenantIsolationViolationError,
} from '../src/tenancy.js';

describe('tenancy', () => {
  it('derives tenant context from session', () => {
    expect(tenantFromSession({ tenantId: 't1' })).toEqual({ tenantId: 't1' });
  });

  it('rejects null session with named error', () => {
    const err = (() => {
      try {
        tenantFromSession(null);
        return null;
      } catch (e) {
        return e as MissingTenantError;
      }
    })();
    expect(err).toBeInstanceOf(MissingTenantError);
    expect(err?.name).toBe('MissingTenantError');
    expect(err?.message).toBe('tenant context is required');
  });

  it('rejects session without tenantId', () => {
    expect(() => tenantFromSession({})).toThrow(MissingTenantError);
  });

  it('accepts record of same tenant', () => {
    expect(() =>
      assertBelongsToTenant({ tenantId: 't1' }, { tenantId: 't1' }),
    ).not.toThrow();
  });

  it('rejects cross-tenant record with named error and detail', () => {
    const err = (() => {
      try {
        assertBelongsToTenant({ tenantId: 't2' }, { tenantId: 't1' });
        return null;
      } catch (e) {
        return e as TenantIsolationViolationError;
      }
    })();
    expect(err).toBeInstanceOf(TenantIsolationViolationError);
    expect(err?.name).toBe('TenantIsolationViolationError');
    expect(err?.message).toBe('cross-tenant access denied (ctx=t1, record=t2)');
  });

  it('scopes queries to current tenant', () => {
    const rows = [
      { tenantId: 't1', v: 1 },
      { tenantId: 't2', v: 2 },
      { tenantId: 't1', v: 3 },
    ];
    expect(scopedQuery(rows, { tenantId: 't1' })).toEqual([
      { tenantId: 't1', v: 1 },
      { tenantId: 't1', v: 3 },
    ]);
    expect(scopedQuery(rows, { tenantId: 't3' })).toEqual([]);
  });
});
