import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

describe('core barrel', () => {
  it('exports all domain modules', () => {
    for (const name of [
      'tenantFromSession',
      'assertBelongsToTenant',
      'scopedQuery',
      'MissingTenantError',
      'TenantIsolationViolationError',
      'AuthorizationService',
      'ForbiddenError',
      'AuditStore',
      'redactPii',
      'Outbox',
      'IdempotentEffectRunner',
      'ModuleCatalog',
      'ModuleNotEntitledError',
    ]) {
      expect(core, name).toHaveProperty(name);
    }
  });
});
