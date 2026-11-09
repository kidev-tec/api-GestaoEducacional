import { describe, it, expect } from 'vitest';
import { Outbox, IdempotentEffectRunner } from '../src/outbox.js';

const ctx = { tenantId: 't1' };

describe('outbox', () => {
  it('enqueues and processes event once', () => {
    const box = new Outbox();
    box.enqueue('e1', 'EnrollmentCreated', 'v1', ctx, { studentId: 's1' });
    const seen: string[] = [];
    const r = box.process((ev) => seen.push(ev.id));
    expect(r).toEqual({ processed: 1, skipped: 0 });
    expect(seen).toEqual(['e1']);
  });

  it('replay does not double-process (at-least-once safe)', () => {
    const box = new Outbox();
    box.enqueue('e1', 'EnrollmentCreated', 'v1', ctx, {});
    box.process(() => {});
    const r2 = box.process(() => {
      throw new Error('must not run again');
    });
    expect(r2).toEqual({ processed: 0, skipped: 1 });
  });

  it('rejects duplicate enqueue id', () => {
    const box = new Outbox();
    box.enqueue('e1', 'T', 'v1', ctx, {});
    expect(() => box.enqueue('e1', 'T', 'v1', ctx, {})).toThrow(/duplicate/);
  });

  it('pending lists only unprocessed of current tenant', () => {
    const box = new Outbox();
    box.enqueue('e1', 'T', 'v1', ctx, {});
    box.enqueue('e2', 'T', 'v1', { tenantId: 't2' }, {});
    box.enqueue('e3', 'T', 'v1', ctx, {});
    box.process(() => {});
    // e3 was processed in same pass; enqueue again to test pending filter
    box.enqueue('e4', 'T', 'v1', ctx, {});
    const pending = box.pending(ctx);
    expect(pending.map((e) => e.id)).toEqual(['e4']);
  });

  it('passes versioned payload to handler', () => {
    const box = new Outbox();
    let captured: { type?: string; version?: string; payload?: unknown } = {};
    box.enqueue('e1', 'Finance.TitlePaid', 'v2', ctx, { amount: 100 });
    box.process((ev) => {
      captured = { type: ev.type, version: ev.version, payload: ev.payload };
    });
    expect(captured.type).toBe('Finance.TitlePaid');
    expect(captured.version).toBe('v2');
    expect(captured.payload).toEqual({ amount: 100 });
  });
});

describe('idempotent effect runner', () => {
  it('applies effect once per event', () => {
    const runner = new IdempotentEffectRunner();
    expect(runner.run('e1', 'bill')).toBe(true);
    expect(runner.run('e1', 'bill')).toBe(false);
    expect(runner.appliedEffects).toEqual(['bill']);
  });

  it('same effect for different events applies each', () => {
    const runner = new IdempotentEffectRunner();
    expect(runner.run('e1', 'bill')).toBe(true);
    expect(runner.run('e2', 'bill')).toBe(true);
    expect(runner.appliedEffects).toEqual(['bill', 'bill']);
  });
});
