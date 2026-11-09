import { describe, it, expect } from 'vitest';
import * as edu from '../src/index.js';

describe('education barrel', () => {
  it('exports all domain modules', () => {
    for (const name of [
      'EnrollmentService',
      'InvalidTransitionError',
      'IdempotencyConflictError',
      'Ledger',
      'Money',
      'ReversalWithoutOriginError',
    ]) {
      expect(edu, name).toHaveProperty(name);
    }
  });
});
