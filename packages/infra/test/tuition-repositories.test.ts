import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import {
  insertPlan, listPlans, generateTuition, settleTuition, cancelTuition, listTuitions, getTuition,
  TuitionRuleError, type TuitionRow,
} from '../src/tuition-repositories.js';
import { NotFoundError, ConflictError } from '../src/people-repositories.js';

type Q = { text: string; values?: unknown[] };
const empty = { rows: [], rowCount: 0 };

/** Fake pg: router por trecho do SQL. Grava calls p/ asserts. */
function fakeClient(route: (q: Q) => { rows: Record<string, unknown>[]; rowCount: number | null }) {
  const calls: Q[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route({ text, values });
    },
    calls,
  };
  return client as never as PoolClient & { calls: Q[] };
}

const planRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', tenant_id: 'A', name: 'Mensal', amount_cents: 50000, due_day: 5, active: true, ...over,
});
const studentRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', tenant_id: 'A', kind: 'STUDENT', active: true, ...over,
});
const tuitionRow = (over: Record<string, unknown> = {}) => ({
  id: 't1', tenant_id: 'A', plan_id: 'p1', student_id: 's1', reference: '2026-03',
  amount_cents: 50000, due_date: '2026-03-05', status: 'OPEN', ledger_entry_id: 'le1', ...over,
});

describe('insertPlan / listPlans', () => {
  it('insere plano válido', async () => {
    const c = fakeClient(() => ({ rows: [planRow()], rowCount: 1 }));
    const plan = await insertPlan(c, { tenantId: 'A', name: 'Mensal', amountCents: 50000, dueDay: 5 });
    expect(plan.amountCents).toBe(50000);
    expect(c.calls[0].text).toContain('INSERT INTO tuition_plans');
  });

  it.each([
    ['amount zero', { amountCents: 0 }],
    ['amount negativo', { amountCents: -1 }],
    ['amount não inteiro', { amountCents: 50.5 }],
    ['dueDay 0', { dueDay: 0 }],
    ['dueDay 13', { dueDay: 13 }],
  ])('valida parâmetros: %s → TuitionRuleError', async (_l, over) => {
    const c = fakeClient(() => ({ rows: [], rowCount: 0 }));
    await expect(insertPlan(c, { tenantId: 'A', name: 'X', amountCents: 50000, dueDay: 5, ...over }))
      .rejects.toBeInstanceOf(TuitionRuleError);
  });

  it('lista só planos ativos do tenant, ordenados', async () => {
    const pool = fakeClient(() => ({ rows: [planRow()], rowCount: 1 }));
    const plans = await listPlans(pool as unknown as never, 'A');
    expect(plans).toHaveLength(1);
    expect((pool as unknown as { calls: Q[] }).calls[0].text).toContain('active');
    expect((pool as unknown as { calls: Q[] }).calls[0].text).toContain('ORDER BY');
  });
});

describe('generateTuition', () => {
  function genClient(over: { plan?: Record<string, unknown>[]; student?: Record<string, unknown>[]; dup?: boolean } = {}) {
    return fakeClient((q) => {
      if (q.text.includes('FROM tuition_plans')) return { rows: over.plan ?? [planRow()], rowCount: (over.plan ?? [planRow()]).length };
      if (q.text.includes('FROM people')) return { rows: over.student ?? [studentRow()], rowCount: (over.student ?? [studentRow()]).length };
      if (q.text.includes('SELECT id FROM tuitions')) return over.dup ? { rows: [{ id: 'x' }], rowCount: 1 } : empty;
      if (q.text.includes('INSERT INTO ledger_entries')) return { rows: [{ id: 'le1', tenant_id: 'A', type: 'CHARGE', amount_cents: 50000, reverses: null }], rowCount: 1 };
      if (q.text.includes('INSERT INTO tuitions')) {
        return { rows: [tuitionRow({ due_date: q.values?.[6] ?? '2026-03-05' })], rowCount: 1 };
      }
      if (q.text.includes('INSERT INTO outbox_events')) {
        return { rows: [{ id: 'ev1', tenant_id: 'A', type: 'tuition.generated', version: '1.0.0', payload: {}, created_at: '2026-11-09T10:00:00Z', processed_at: null, attempts: 0, next_attempt_at: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('plano inativo → TuitionRuleError', async () => {
    const c = genClient({ plan: [planRow({ active: false })] });
    await expect(generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' }))
      .rejects.toThrow('plan inactive');
  });

  it('gera tuition OPEN + CHARGE transacional; dueDate default do plano', async () => {
    const c = genClient();
    const t = await generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' });
    expect(t.status).toBe('OPEN');
    expect(t.dueDate).toBe('2026-03-05');
    const texts = c.calls.map((x) => x.text);
    const chargeIdx = texts.findIndex((x) => x.includes('INSERT INTO ledger_entries'));
    const tuitionIdx = texts.findIndex((x) => x.includes('INSERT INTO tuitions'));
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(tuitionIdx).toBeGreaterThan(chargeIdx); // charge antes do tuition na mesma tx
  });

  it('dueDate explícita vence sobre o plano', async () => {
    const c = genClient();
    const t = await generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03', dueDate: '2026-03-20' });
    expect(t.dueDate).toBe('2026-03-20');
  });

  it('E03-A: generateTuition enfileira tuition.generated na MESMA sequência (tx única)', async () => {
    const c = genClient();
    await generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' });
    const texts = c.calls.map((x) => x.text);
    const tuitionIdx = texts.findIndex((x) => x.includes('INSERT INTO tuitions'));
    const outboxIdx = texts.findIndex((x) => x.includes('INSERT INTO outbox_events'));
    expect(outboxIdx).toBeGreaterThan(tuitionIdx);
    const outboxInsert = c.calls[outboxIdx];
    expect(outboxInsert?.values?.[2]).toBe('tuition.generated');
    expect(outboxInsert?.values?.[4]).toContain('tuitionId');
  });

  it.each([
    ['2026-3', 'formato inválido'],
    ['2026-13', 'mês 13'],
    ['26-03', 'ano curto'],
    ['202603', 'sem hífen'],
  ])('reference %s → TuitionRuleError', async (ref) => {
    const c = genClient();
    await expect(generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: ref }))
      .rejects.toBeInstanceOf(TuitionRuleError);
  });

  it('plano inexistente/outro tenant → NotFoundError', async () => {
    const c = genClient({ plan: [] });
    await expect(generateTuition(c, { tenantId: 'A', planId: 'ghost', studentId: 's1', reference: '2026-03' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('aluno inexistente → NotFoundError; kind errado/inativo → TuitionRuleError', async () => {
    const noStudent = genClient({ student: [] });
    await expect(generateTuition(noStudent, { tenantId: 'A', planId: 'p1', studentId: 'ghost', reference: '2026-03' }))
      .rejects.toBeInstanceOf(NotFoundError);
    const staff = genClient({ student: [studentRow({ kind: 'STAFF' })] });
    await expect(generateTuition(staff, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' }))
      .rejects.toBeInstanceOf(TuitionRuleError);
    const inactive = genClient({ student: [studentRow({ active: false })] });
    await expect(generateTuition(inactive, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' }))
      .rejects.toBeInstanceOf(TuitionRuleError);
  });

  it('competência duplicada (pré-check) → ConflictError; ON CONFLICT vazios → ConflictError', async () => {
    const c = genClient({ dup: true });
    await expect(generateTuition(c, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' }))
      .rejects.toBeInstanceOf(ConflictError);
    const raced = fakeClient((q) => {
      if (q.text.includes('FROM tuition_plans')) return { rows: [planRow()], rowCount: 1 };
      if (q.text.includes('FROM people')) return { rows: [studentRow()], rowCount: 1 };
      if (q.text.includes('SELECT id FROM tuitions')) return empty;
      if (q.text.includes('INSERT INTO ledger_entries')) return { rows: [{ id: 'le1', tenant_id: 'A', type: 'CHARGE', amount_cents: 50000, reverses: null }], rowCount: 1 };
      if (q.text.includes('INSERT INTO tuitions')) return empty; // ON CONFLICT DO NOTHING → sem linha
      return empty;
    });
    await expect(generateTuition(raced, { tenantId: 'A', planId: 'p1', studentId: 's1', reference: '2026-03' }))
      .rejects.toBeInstanceOf(ConflictError);
  });
});

describe('settleTuition', () => {
  function settleClient(t: Record<string, unknown>, replayEntryId?: string) {
    return fakeClient((q) => {
      if (q.text.includes('FROM tuitions WHERE id')) return { rows: [t], rowCount: 1 };
      if (q.text.includes('JOIN ledger_idempotency')) {
        return replayEntryId ? { rows: [{ ledger_entry_id: replayEntryId }], rowCount: 1 } : empty;
      }
      if (q.text.includes('INSERT INTO ledger_entries')) return { rows: [{ id: 'pay1', tenant_id: 'A', type: 'PAYMENT', amount_cents: 50000, reverses: null }], rowCount: 1 };
      if (q.text.includes('INSERT INTO payment_allocations')) return { rows: [{ id: 'a1' }], rowCount: 1 };
      if (q.text.includes('UPDATE tuitions')) return { rows: [tuitionRow({ status: 'SETTLED' })], rowCount: 1 };
      return empty;
    });
  }

  it('quita OPEN com valor exato: PAYMENT + alocação + SETTLED', async () => {
    const c = settleClient(tuitionRow());
    const { tuition, ledgerEntryId } = await settleTuition(c, { tenantId: 'A', tuitionId: 't1', paymentAmountCents: 50000, idempotencyKey: 'k1' });
    expect(tuition.status).toBe('SETTLED');
    expect(ledgerEntryId).toBe('pay1');
    const texts = c.calls.map((x) => x.text);
    expect(texts.some((x) => x.includes('payment_allocations'))).toBe(true);
    expect(texts.some((x) => x.includes('UPDATE tuitions'))).toBe(true);
  });

  it('tuition inexistente/outro tenant → NotFoundError', async () => {
    const c = fakeClient((q) => (q.text.includes('FROM tuitions WHERE id') ? empty : empty));
    await expect(settleTuition(c, { tenantId: 'A', tuitionId: 'ghost', paymentAmountCents: 50000, idempotencyKey: 'k' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('replay idempotente: SETTLED + mesma key → retorna alocação original sem erro', async () => {
    const c = settleClient(tuitionRow({ status: 'SETTLED' }), 'orig-pay-1');
    const res = await settleTuition(c, { tenantId: 'A', tuitionId: 't1', paymentAmountCents: 50000, idempotencyKey: 'k1' });
    expect(res.ledgerEntryId).toBe('orig-pay-1');
    expect(res.tuition.status).toBe('SETTLED');
  });

  it.each([
    ['status SETTLED', tuitionRow({ status: 'SETTLED' })],
    ['status CANCELED', tuitionRow({ status: 'CANCELED' })],
  ])('settle de %s → TuitionRuleError', async (_l, t) => {
    const c = settleClient(t);
    await expect(settleTuition(c, { tenantId: 'A', tuitionId: 't1', paymentAmountCents: 50000, idempotencyKey: 'k' }))
      .rejects.toBeInstanceOf(TuitionRuleError);
  });

  it.each([
    ['valor menor', 49999],
    ['valor maior (sobras rejeitadas)', 50001],
    ['valor zero', 0],
    ['negativo', -1],
  ])('%s → TuitionRuleError', async (_l, amount) => {
    const c = settleClient(tuitionRow());
    await expect(settleTuition(c, { tenantId: 'A', tuitionId: 't1', paymentAmountCents: amount, idempotencyKey: 'k' }))
      .rejects.toBeInstanceOf(TuitionRuleError);
  });
});

describe('cancelTuition', () => {
  function cancelClient(t: Record<string, unknown>, reversalOk = true) {
    return fakeClient((q) => {
      if (q.text.includes('FROM tuitions WHERE id')) return { rows: [t], rowCount: 1 };
      if (q.text.includes('FOR UPDATE')) {
        // SELECT do original p/ REVERSAL: retorna o charge le1 (CHARGE +50000)
        return { rows: [{ type: 'CHARGE', amount_cents: 50000, tenant_id: 'A' }], rowCount: 1 };
      }
      if (q.text.includes('INSERT INTO ledger_entries')) {
        if (!reversalOk) throw new Error('ledger boom');
        return { rows: [{ id: 'rev1', tenant_id: 'A', type: 'REVERSAL', amount_cents: -50000, reverses: 'le1' }], rowCount: 1 };
      }
      if (q.text.includes('UPDATE tuitions')) return { rows: [tuitionRow({ status: 'CANCELED' })], rowCount: 1 };
      return empty;
    });
  }

  it('cancela OPEN: REVERSAL espelhando charge + status CANCELED', async () => {
    const c = cancelClient(tuitionRow());
    const t = await cancelTuition(c, 'A', 't1');
    expect(t.status).toBe('CANCELED');
    const reversal = c.calls.find((x) => x.text.includes('INSERT INTO ledger_entries'));
    expect(reversal?.values?.[3]).toBe(-50000); // amount negativo espelha
    expect(reversal?.values?.[4]).toBe('le1');  // reverses o charge
  });
  it('cancel de SETTLED/CANCELED → TuitionRuleError; sem charge → TuitionRuleError', async () => {
    const settled = cancelClient(tuitionRow({ status: 'SETTLED' }));
    await expect(cancelTuition(settled, 'A', 't1')).rejects.toBeInstanceOf(TuitionRuleError);
    const noCharge = cancelClient(tuitionRow({ ledger_entry_id: null }));
    await expect(cancelTuition(noCharge, 'A', 't1')).rejects.toBeInstanceOf(TuitionRuleError);
  });

  it('tuition inexistente → NotFoundError', async () => {
    const c = fakeClient(() => empty);
    await expect(cancelTuition(c, 'A', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listTuitions / getTuition', () => {
  it('monta filtros status/studentId/reference', async () => {
    const pool = fakeClient(() => ({ rows: [tuitionRow()], rowCount: 1 }));
    await listTuitions(pool as unknown as never, 'A', { status: 'OPEN', studentId: 's1', reference: '2026-03' });
    const text = (pool as unknown as { calls: Q[] }).calls[0].text;
    expect(text).toContain('t.status = $2');
    expect(text).toContain('t.student_id = $3');
    expect(text).toContain('t.reference = $4');
    await listTuitions(pool as unknown as never, 'A', {});
    expect((pool as unknown as { calls: Q[] }).calls[1].text).not.toContain('t.status = $');
  });

  it('getTuition mapeia row; inexistente → NotFoundError', async () => {
    const pool = fakeClient(() => ({ rows: [tuitionRow()], rowCount: 1 }));
    const t = await getTuition(pool as unknown as never, 'A', 't1');
    expect(t.reference).toBe('2026-03');
    const gone = fakeClient(() => empty);
    await expect(getTuition(gone as unknown as never, 'A', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('due_date como objeto (pg Date meia-noite local) vira YYYY-MM-DD sem shift UTC', async () => {
    const pool = fakeClient(() => ({ rows: [tuitionRow({ due_date: new Date(2026, 2, 5) })], rowCount: 1 })); // 05/03/2026 local
    const t = await getTuition(pool as unknown as never, 'A', 't1');
    expect(t.dueDate).toBe('2026-03-05');
  });
});
