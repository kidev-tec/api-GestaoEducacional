/**
 * E07-B — financeIntegrity unit (fake router, 100×4).
 */
import { describe, expect, it } from 'vitest';
import { financeIntegrity } from '../src/integrity-repositories.js';

interface Call { text: string; values?: unknown[] }

function fakeClient(routes: [RegExp, (c: Call) => { rows: Record<string, unknown>[]; rowCount: number }][]): {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values: values ?? [] });
      for (const [re, fn] of routes) if (re.test(text)) return fn({ text, values: values ?? [] });
      return { rows: [], rowCount: 0 };
    },
  };
}
const W = (rows: Record<string, unknown>[], n?: number) => ({ rows, rowCount: n ?? rows.length });

describe('financeIntegrity', () => {
  it('tenant vazio → healthy true, balanced not_applicable', async () => {
    const client = fakeClient([
      [/reverses IS NOT NULL AND o\.id IS NULL/, () => W([])],
      [/amount_cents != -o\.amount_cents/, () => W([])],
      [/o\.type = 'REVERSAL'/, () => W([])],
      [/COUNT\(\*\) FROM ledger_entries r WHERE r\.reverses/, () => W([])],
      [/ledger_idempotency/, () => W([])],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 0, with_account: 0 }])],
    ]);
    const r = await financeIntegrity(client as never, 'A');
    expect(r.healthy).toBe(true);
    expect(r.checks.balanced_check).toBe('not_applicable');
    expect(r.checks.reversal_target_missing).toBe(0);
  });

  it('conta ghosts/mismatch/chain/dup/orphan e monta sample (max 5 ids)', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `id-${i}`);
    const client = fakeClient([
      [/o\.id IS NULL/, () => W(ids.map((id) => ({ id })), 7)],
      [/amount_cents != -o/, () => W([{ id: 'mm-1' }])],
      [/o\.type = 'REVERSAL'/, () => W([{ id: 'ch-1' }])],
      [/r\.reverses = o\.id/, () => W([{ id: 'dup-1' }])],
      [/ledger_idempotency/, () => W([{ id: 'A:orphan-key' }])],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 10, with_account: 10 }])],
      [/GROUP BY doc_id/, () => W([{ doc_id: 'd1', net: 50 }], 1)],
    ]);
    const r = await financeIntegrity(client as never, 'A');
    expect(r.healthy).toBe(false);
    expect(r.checks.reversal_target_missing).toBe(7);
    expect(r.sample.reversal_target_missing).toHaveLength(5); // cap de 5
    expect(r.checks.balanced_check).toBe('fail');
    expect(r.checks.unbalanced_entries).toBe(1);
    expect(r.sample.unbalanced_entries).toEqual(['d1']);
  });

  it('com account parcial (nem todo entry tem account) → not_applicable (legado)', async () => {
    const client = fakeClient([
      [/o\.id IS NULL/, () => W([])],
      [/amount_cents != -o/, () => W([])],
      [/o\.type = 'REVERSAL'/, () => W([])],
      [/r\.reverses = o\.id/, () => W([])],
      [/ledger_idempotency/, () => W([])],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 10, with_account: 4 }])],
    ]);
    const r = await financeIntegrity(client as never, 'A');
    expect(r.checks.balanced_check).toBe('not_applicable');
    expect(r.checks.unbalanced_entries).toBeUndefined();
    expect(r.healthy).toBe(true);
  });

  it('com account total e doc balanceado → pass', async () => {
    const client = fakeClient([
      [/o\.id IS NULL/, () => W([])],
      [/amount_cents != -o/, () => W([])],
      [/o\.type = 'REVERSAL'/, () => W([])],
      [/r\.reverses = o\.id/, () => W([])],
      [/ledger_idempotency/, () => W([])],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 3, with_account: 3 }])],
      [/GROUP BY doc_id/, () => W([])],
    ]);
    const r = await financeIntegrity(client as never, 'A');
    expect(r.checks.balanced_check).toBe('pass');
    expect(r.healthy).toBe(true);
  });

  it('rowCount undefined → fallback ?? 0 (fake sem rowCount)', async () => {
    const client = fakeClient([
      [/o\.id IS NULL/, () => ({ rows: [], rowCount: undefined as unknown as number })],
      [/amount_cents != -o/, () => ({ rows: [], rowCount: undefined as unknown as number })],
      [/o\.type = 'REVERSAL'/, () => ({ rows: [], rowCount: undefined as unknown as number })],
      [/r\.reverses = o\.id/, () => ({ rows: [], rowCount: undefined as unknown as number })],
      [/ledger_idempotency/, () => ({ rows: [], rowCount: undefined as unknown as number })],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 0, with_account: 0 }])],
    ]);
    const r = await financeIntegrity(client as never, 'A');
    expect(r.checks.reversal_target_missing).toBe(0);
    expect(r.checks.reversal_amount_mismatch).toBe(0);
    expect(r.checks.reversal_chain).toBe(0);
    expect(r.checks.duplicate_reversal).toBe(0);
    expect(r.checks.idempotency_orphan).toBe(0);
    expect(r.healthy).toBe(true);
  });

  it('sempre filtra por tenant (cada query recebe tenantId como bind $1)', async () => {
    const client = fakeClient([
      [/o\.id IS NULL/, () => W([])],
      [/amount_cents != -o/, () => W([])],
      [/o\.type = 'REVERSAL'/, () => W([])],
      [/r\.reverses = o\.id/, () => W([])],
      [/ledger_idempotency/, () => W([])],
      [/COUNT\(\*\)::int AS total/, () => W([{ total: 0, with_account: 0 }])],
    ]);
    await financeIntegrity(client as never, 'T-XYZ');
    const tenantBinds = client.calls.filter((c) => c.values?.[0] === 'T-XYZ');
    expect(tenantBinds.length).toBeGreaterThanOrEqual(5); // todas as queries tenant-scoped
  });
});
