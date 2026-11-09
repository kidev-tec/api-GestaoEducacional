import { describe, it, expect } from 'vitest';
import { AuditStore, redactPii } from '../src/audit.js';

describe('audit store', () => {
  it('appends with sequential seq and timestamp', () => {
    const store = new AuditStore();
    const r1 = store.append({ tenantId: 't1', actorId: 'a1', action: 'create', resourceType: 'student', resourceId: 's1' });
    const r2 = store.append({ tenantId: 't1', actorId: 'a2', action: 'update', resourceType: 'student', resourceId: 's1' });
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(r1.at).toBeTruthy();
    expect(r2.at).toBeTruthy();
  });

  it('accepts explicit at and correlationId', () => {
    const store = new AuditStore();
    const r = store.append({
      tenantId: 't1', actorId: 'a1', action: 'create', resourceType: 'enrollment', resourceId: 'e1',
      at: '2026-01-01T00:00:00Z', correlationId: 'c-42',
    });
    expect(r.at).toBe('2026-01-01T00:00:00Z');
    expect(r.correlationId).toBe('c-42');
  });

  it('lists only current tenant records', () => {
    const store = new AuditStore();
    store.append({ tenantId: 't1', actorId: 'a1', action: 'x', resourceType: 'r', resourceId: '1' });
    store.append({ tenantId: 't2', actorId: 'a2', action: 'x', resourceType: 'r', resourceId: '2' });
    const list = store.list({ tenantId: 't1' });
    expect(list).toHaveLength(1);
    expect(list[0]!.actorId).toBe('a1');
    expect(store.count()).toBe(2);
  });

  it('records are frozen (immutable)', () => {
    const store = new AuditStore();
    const r = store.append({ tenantId: 't1', actorId: 'a1', action: 'x', resourceType: 'r', resourceId: '1' });
    expect(() => {
      (r as { action: string }).action = 'tampered';
    }).toThrow();
    expect(r.action).toBe('x');
  });
});

describe('redactPii', () => {
  it('redacts known pii keys regardless of case', () => {
    const out = redactPii({ CPF: '123', email: 'a@b.c', note: 'ok', Telefone: '999' });
    expect(out).toEqual({ CPF: '[REDACTED]', email: '[REDACTED]', note: 'ok', Telefone: '[REDACTED]' });
  });

  it('keeps non-pii keys', () => {
    const out = redactPii({ studentId: 's1', tenantId: 't1' });
    expect(out).toEqual({ studentId: 's1', tenantId: 't1' });
  });
});
