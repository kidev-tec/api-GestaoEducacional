/**
 * E06-06 unit — commission-repositories 100×4 (fake PG).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CommissionRuleError, computeCommission, createCommissionRule, listCommissionRules,
  reconcileCommission, confirmCredit, listCredits, upsertTarget, targetProgress, mapCommissionError,
} from '../src/commission-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
      queries.push(q);
      const rows = responder(q);
      return { rows, rowCount: rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const RULE = {
  id: 'r1', tenant_id: 'T', name: 'Comissão padrão', version: 1, kind: 'PERCENT', value: '10',
  target_user_id: null, min_total_cents: null, valid_from: '2026-01-01', valid_to: null,
};

describe('computeCommission (R4)', () => {
  it('PERCENT half-up, FLAT cap, base inválida', () => {
    expect(computeCommission(80000, 'PERCENT', 10)).toBe(8000);
    expect(computeCommission(12345, 'PERCENT', 5)).toBe(617); // 617.25 → 617 half-up
    expect(computeCommission(12345, 'PERCENT', 5.5)).toBe(679); // 678.975 → 679
    expect(computeCommission(1000, 'FLAT', 3000)).toBe(1000); // cap no base
    expect(computeCommission(1000, 'FLAT', 500)).toBe(500);
    expect(() => computeCommission(0, 'PERCENT', 10)).toThrow(CommissionRuleError);
  });
});

describe('createCommissionRule (R1)', () => {
  it('v1 sem fechar nada; v2 fecha v1; validações', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('ORDER BY version DESC')) return [];
      if (q.text.includes('INSERT INTO commission_rules')) return [{ ...RULE, version: q.values[3] as number }];
      return [];
    });
    const v1 = await createCommissionRule(client, 'T', { name: 'X', kind: 'PERCENT', value: 10 }, 'u');
    expect(v1.version).toBe(1);
    expect(queries.find((q) => q.text.trim().startsWith('UPDATE commission_rules'))).toBeUndefined();
    // v2
    const { client: c2, queries: q2 } = fakeClient((q) => {
      if (q.text.includes('ORDER BY version DESC')) return [{ version: 1 }];
      if (q.text.includes('INSERT INTO commission_rules')) return [{ ...RULE, version: 2 }];
      return [];
    });
    const v2 = await createCommissionRule(c2, 'T', { name: 'X', kind: 'FLAT', value: 5000 }, 'u');
    expect(v2.version).toBe(2);
    const close = q2.find((q) => q.text.trim().startsWith('UPDATE commission_rules'))!;
    expect(close.text).toContain('valid_to = CURRENT_DATE - 1');
    // validações
    const { client: c3 } = fakeClient(() => []);
    await expect(createCommissionRule(c3, 'T', { name: '', kind: 'PERCENT', value: 10 }, 'u')).rejects.toThrow(CommissionRuleError);
    await expect(createCommissionRule(c3, 'T', { name: 'X', kind: 'PERCENT', value: 51 }, 'u')).rejects.toThrow(CommissionRuleError);
    await expect(createCommissionRule(c3, 'T', { name: 'X', kind: 'PERCENT', value: 0 }, 'u')).rejects.toThrow(CommissionRuleError);
    await expect(createCommissionRule(c3, 'T', { name: 'X', kind: 'FLAT', value: 0 }, 'u')).rejects.toThrow(CommissionRuleError);
  });
});

describe('listCommissionRules', () => {
  it('active filtra vigentes; all retorna tudo', async () => {
    const { client, queries } = fakeClient(() => [RULE]);
    await listCommissionRules(client, 'T', true);
    expect(queries[0].text).toContain('valid_from <= CURRENT_DATE');
    await listCommissionRules(client, 'T', false);
    expect(queries[1].text).not.toContain('valid_from <= CURRENT_DATE');
  });
});

describe('reconcileCommission (R2/R3/R5)', () => {
  const ok = (over: Partial<typeof RULE> = {}) => (q: Q) => {
    if (q.text.includes('FROM enrollments WHERE')) return q.values[0] === 'e1' ? [{ id: 'e1' }] : [];
    if (q.text.includes('FROM commission_rules')) return [{ ...RULE, ...over }];
    if (q.text.includes('INSERT INTO commission_credits')) return [{ ...RULE, id: 'c1', rule_id: RULE.id, rule_version: RULE.version, enrollment_id: 'e1', user_id: 'v1', base_cents: 80000, amount_cents: 8000, status: 'PENDING', source_event: 'tuition.settled', source_id: 's1' }];
    return [];
  };
  it('404 matrícula; base inválida; cria crédito PENDING', async () => {
    const { client } = fakeClient(ok());
    await expect(reconcileCommission(client, 'T', { enrollmentId: 'zz', userId: 'v1', baseCents: 80000, sourceEvent: 'tuition.settled', sourceId: 's1' })).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient(ok());
    await expect(reconcileCommission(c2, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 0, sourceEvent: 'tuition.settled', sourceId: 's1' })).rejects.toThrow(CommissionRuleError);
    const { client: c3 } = fakeClient(ok());
    const r = await reconcileCommission(c3, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'tuition.settled', sourceId: 's1' });
    expect(r.created).toHaveLength(1);
    expect(r.created[0].amountCents).toBe(8000);
  });
  it('R3: min_total filtra; target_user filtra; conflito UNIQUE não cria', async () => {
    const { client } = fakeClient(ok({ min_total_cents: 100000 }));
    const r1 = await reconcileCommission(client, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'tuition.settled', sourceId: 's1' });
    expect(r1.created).toHaveLength(0);
    // target_user filtrado pelo WHERE do SQL — fake simula: regra não retorna para outro vendedor
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM enrollments WHERE')) return [{ id: 'e1' }];
      if (q.text.includes('FROM commission_rules')) return []; // WHERE excluiu (target='outro' ≠ v1)
      return [];
    });
    const r2 = await reconcileCommission(c2, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'tuition.settled', sourceId: 's1' });
    expect(r2.created).toHaveLength(0);
    // regra elegível mas crédito duplicado (ON CONFLICT DO NOTHING → rowCount 0 → INSERT não retorna)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM enrollments WHERE')) return [{ id: 'e1' }];
      if (q.text.includes('FROM commission_rules')) return [RULE];
      if (q.text.includes('ON CONFLICT (tenant_id, enrollment_id, rule_version, user_id)')) return []; // conflito
      return [];
    });
    const r3 = await reconcileCommission(c3, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'tuition.settled', sourceId: 's1' });
    expect(r3.created).toHaveLength(0); // conflito skip (idempotente)
  });
  it('R5: ledger.reversal reverte PENDING/CONFIRMED', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM enrollments WHERE')) return [{ id: 'e1' }];
      if (q.text.includes('FROM commission_rules')) return [];
      if (q.text.includes("status IN ('PENDING','CONFIRMED')")) return [{ ...RULE, id: 'c1', rule_id: 'r1', rule_version: 1, enrollment_id: 'e1', user_id: 'v1', base_cents: 80000, amount_cents: 8000, status: 'REVERSED', source_event: 'tuition.settled', source_id: 's1' }];
      return [];
    });
    const r = await reconcileCommission(client, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'ledger.reversal', sourceId: 'x' });
    expect(r.reversed).toHaveLength(1);
    expect(r.reversed[0].status).toBe('REVERSED');
    // reversal com nenhuma regra e nada p/ reverter
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM enrollments WHERE')) return [{ id: 'e1' }];
      return [];
    });
    const r2 = await reconcileCommission(c2, 'T', { enrollmentId: 'e1', userId: 'v1', baseCents: 80000, sourceEvent: 'ledger.reversal', sourceId: 'x' });
    expect(r2.created).toHaveLength(0);
    expect(r2.reversed).toHaveLength(0);
  });
});

describe('confirmCredit (R6)', () => {
  const credRow = { ...RULE, id: 'c1', rule_id: 'r1', rule_version: 1, enrollment_id: 'e1', user_id: 'v1', base_cents: 80000, amount_cents: 8000, status: 'CONFIRMED', source_event: 'tuition.settled', source_id: 's1' };
  it('role sem alçada 422; 404 não-PENDING; confirma PENDING', async () => {
    const { client } = fakeClient(() => [credRow]);
    await expect(confirmCredit(client, 'T', 'c1', 'viewer')).rejects.toThrow(CommissionRuleError);
    const { client: c2 } = fakeClient(() => []);
    await expect(confirmCredit(c2, 'T', 'c1', 'admin')).rejects.toThrow(NotFoundError);
    const { client: c3 } = fakeClient(() => [credRow]);
    const c = await confirmCredit(c3, 'T', 'c1', 'owner');
    expect(c.status).toBe('CONFIRMED');
  });
});

describe('listCredits / targets', () => {
  it('filtros userId/status; upsert valida; progresso CONFIRMED', async () => {
    const credRow = { ...RULE, id: 'c1', rule_id: 'r1', rule_version: 1, enrollment_id: 'e1', user_id: 'v1', base_cents: 80000, amount_cents: 8000, status: 'PENDING', source_event: 'tuition.settled', source_id: 's1' };
    const { client, queries } = fakeClient(() => [credRow]);
    await listCredits(client, 'T', {});
    expect(queries[0].text).not.toContain('user_id = $2');
    await listCredits(client, 'T', { userId: 'v1', status: 'PENDING' });
    expect(queries[1].values).toEqual(['T', 'v1', 'PENDING']);
    const { client: c2 } = fakeClient(() => []);
    await expect(upsertTarget(c2, 'T', { userId: 'v', period: '2026-13', amountCents: 100 })).rejects.toThrow(CommissionRuleError);
    await expect(upsertTarget(c2, 'T', { userId: 'v', period: '2026-11', amountCents: 0 })).rejects.toThrow(CommissionRuleError);
    // progresso
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM sales_targets')) return [{ user_id: 'v1', amount_cents: 10000 }];
      if (q.text.includes('SUM(amount_cents)')) return [{ total: '8000' }];
      return [];
    });
    const p = await targetProgress(c3, 'T', '2026-11');
    expect(p[0].progressPct).toBe(80);
    await expect(targetProgress(c3, 'T', 'xx')).rejects.toThrow(CommissionRuleError);
  });
});

describe('branches finais commissions', () => {
  it('upsert OK, iso null/Date, kind/value inválidos', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO sales_targets')) return [{ id: 't1' }];
      return [];
    });
    const t = await upsertTarget(client, 'T', { userId: 'v1', period: '2026-11', amountCents: 5000 });
    expect(t.amountCents).toBe(5000);
    expect(queries[0].text).toContain('ON CONFLICT');
    const { client: c2 } = fakeClient(() => []);
    await expect(createCommissionRule(c2, 'T', { name: 'X', kind: 'ABS' as 'PERCENT', value: 10 }, 'u')).rejects.toThrow(CommissionRuleError);
    await expect(createCommissionRule(c2, 'T', { name: 'X', kind: 'PERCENT', value: '10' as unknown as number }, 'u')).rejects.toThrow(CommissionRuleError);
    await expect(targetProgress(c2, 'T', '2026-13')).rejects.toThrow(CommissionRuleError);
    const { client: c3 } = fakeClient(() => [{ ...RULE, valid_to: new Date('2026-12-31T00:00:00Z'), target_user_id: 'v1', min_total_cents: 5000 }]);
    const rules = await listCommissionRules(c3, 'T', false);
    expect(rules[0].validTo).toBe('2026-12-31');
    expect(rules[0].targetUserId).toBe('v1');
  });
});

describe('mapCommissionError', () => {
  it('mapeia classes', () => {
    expect(mapCommissionError(new CommissionRuleError('x')).status).toBe(422);
    expect(mapCommissionError(new NotFoundError('x')).status).toBe(404);
    expect(mapCommissionError(new Error('x')).status).toBe(500);
  });
});
