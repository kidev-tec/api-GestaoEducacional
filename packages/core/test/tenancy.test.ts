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

  it('rejects null session', () => {
    expect(() => tenantFromSession(null)).toThrow(MissingTenantError);
  });

  it('rejects session without tenantId', () => {
    expect(() => tenantFromSession({})).toThrow(MissingTenantError);
  });

  it('accepts record of same tenant', () => {
    expect(() =>
      assertBelongsToTenant({ tenantId: 't1' }, { tenantId: 't1' }),
    ).not.toThrow();
  });

  it('rejects cross-tenant record', () => {
    expect(() =>
      assertBelongsToTenant({ tenantId: 't2' }, { tenantId: 't1' }),
    ).toThrow(TenantIsolationViolationError);
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
