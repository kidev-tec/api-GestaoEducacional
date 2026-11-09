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

  it('entitlement is per tenant', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'enrollment');
    expect(cat.isEnabled('t1', 'enrollment')).toBe(true);
    expect(cat.isEnabled('t2', 'enrollment')).toBe(false);
  });

  it('require passes when entitled', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'audit');
    expect(() => cat.require('t1', 'audit')).not.toThrow();
  });

  it('require throws when not entitled', () => {
    const cat = new ModuleCatalog();
    expect(() => cat.require('t1', 'billing')).toThrow(ModuleNotEntitledError);
  });
});
