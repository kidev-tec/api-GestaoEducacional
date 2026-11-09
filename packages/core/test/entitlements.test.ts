import { describe, it, expect } from 'vitest';
import { ModuleCatalog, ModuleNotEntitledError } from '../src/entitlements.js';

describe('module catalog', () => {
  it('module disabled by default', () => {
    const cat = new ModuleCatalog();
    expect(cat.isEnabled('t1', 'crm')).toBe(false);
  });

  it('enable then disable lifecycle', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'finance');
    expect(cat.isEnabled('t1', 'finance')).toBe(true);
    cat.disable('t1', 'finance');
    expect(cat.isEnabled('t1', 'finance')).toBe(false);
  });

  it('entitlement is per tenant, disable on unknown tenant is safe', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'enrollment');
    expect(cat.isEnabled('t1', 'enrollment')).toBe(true);
    expect(cat.isEnabled('t2', 'enrollment')).toBe(false);
    expect(() => cat.disable('tX', 'enrollment')).not.toThrow();
  });

  it('require passes when entitled', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'audit');
    expect(() => cat.require('t1', 'audit')).not.toThrow();
  });

  it('require throws named error with tenant and module', () => {
    const cat = new ModuleCatalog();
    try {
      cat.require('t1', 'billing');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as ModuleNotEntitledError;
      expect(err.name).toBe('ModuleNotEntitledError');
      expect(err.message).toBe('module billing not entitled for tenant t1');
    }
  });
});
