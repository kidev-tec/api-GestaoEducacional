import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  validateContractInput, nextReference, createSchoolContract, getSchoolContract, listSchoolContracts,
  activateSchoolContract, cancelSchoolContract, ContractRuleError,
} from '../src/school-contract-repositories.js';
import { NotFoundError, ConflictError } from '../src/people-repositories.js';
import { generateTuition, cancelTuition } from '../src/tuition-repositories.js';

vi.mock('../src/repositories.js', () => ({ withTransaction: vi.fn(async (_p: Pool, fn: (c: PoolClient) => unknown) => fn(fakeTx)) }));
vi.mock('../src/tuition-repositories.js', () => ({ generateTuition: vi.fn(), cancelTuition: vi.fn() }));

type Q = { text: string; values?: unknown[] };

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

const has = (q: Q, frag: string) => q.text.includes(frag);

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1', tenant_id: 'A', enrollment_id: 'e1', plan_id: 'p1', monthly_price_cents: 42000,
  installments: 3, start_reference: '2026-03', status: 'DRAFT', created_by: 'u1', ...over,
});

const base = { tenantId: 'A', enrollmentId: 'e1', planId: 'p1', monthlyPriceCents: 42000, installments: 3, startReference: '2026-03', createdBy: 'u1', idempotencyKey: 'k1' };

/** rota padrão: enrollment ACTIVE + plano existe + sem idempotency + insert ok */
function defaultRoute(over: Record<string, (q: Q) => { rows: Record<string, unknown>[]; rowCount: number | null }> = {}) {
  return (q: Q) => {
    for (const [frag, fn] of Object.entries(over)) if (has(q, frag)) return fn(q);
    if (has(q, 'FROM enrollments WHERE id = $1 AND tenant_id = $2 AND state')) return { rows: [{ id: 'e1' }], rowCount: 1 };
    if (has(q, 'FROM enrollments WHERE id = $1 AND tenant_id = $2')) return { rows: [{ id: 'e1', student_id: 's1' }], rowCount: 1 };
    if (has(q, 'FROM tuition_plans')) return { rows: [{ id: 'p1' }], rowCount: 1 };
    if (has(q, 'FROM school_contract_idempotency')) return { rows: [], rowCount: 0 };
    if (q.text.startsWith('INSERT INTO school_contracts')) return { rows: [contractRow()], rowCount: 1 };
    if (has(q, 'INSERT INTO school_contract_idempotency')) return { rows: [], rowCount: 0 };
    if (has(q, 'INSERT INTO audit_records')) return { rows: [], rowCount: 0 };
    if (q.text.includes('FROM school_contracts WHERE id = $1 AND tenant_id = $2')) return { rows: [contractRow()], rowCount: 1 };
    if (q.text.includes('FROM school_contracts WHERE tenant_id = $1 ORDER BY')) return { rows: [contractRow()], rowCount: 1 };
    if (q.text.includes("status = 'ACTIVE' WHERE")) return { rows: [], rowCount: 1 };
    if (q.text.includes("status = 'CANCELED', canceled_at")) return { rows: [], rowCount: 1 };
    if (has(q, "FROM tuitions WHERE tenant_id = $1 AND student_id = $2 AND status = 'OPEN'")) {
      return { rows: [{ id: 't1', reference: '2026-03' }, { id: 't2', reference: '2026-04' }, { id: 't9', reference: '2030-01' }], rowCount: 3 };
    }
    throw new Error(`fakeClient sem rota: ${q.text.slice(0, 80)}`);
  };
}

let fakeTx: PoolClient & { calls: Q[] };
const baseParams = { tenantId: 'A', enrollmentId: 'e1', planId: 'p1' };

describe('validateContractInput / nextReference', () => {
  it('aceita input válido', () => {
    expect(() => validateContractInput({ monthlyPriceCents: 100, installments: 1, startReference: '2026-01' })).not.toThrow();
  });
  it('rejeita price <= 0, installments fora 1..12, reference inválida', () => {
    expect(() => validateContractInput({ monthlyPriceCents: 0, installments: 1, startReference: '2026-01' })).toThrow(ContractRuleError);
    expect(() => validateContractInput({ monthlyPriceCents: 100, installments: 0, startReference: '2026-01' })).toThrow(ContractRuleError);
    expect(() => validateContractInput({ monthlyPriceCents: 100, installments: 13, startReference: '2026-01' })).toThrow(ContractRuleError);
    expect(() => validateContractInput({ monthlyPriceCents: 100, installments: 1, startReference: '2026-13' })).toThrow(ContractRuleError);
    expect(() => validateContractInput({ monthlyPriceCents: 100, installments: 1, startReference: '26-01' })).toThrow(ContractRuleError);
  });
  it('nextReference avança mês e ano', () => {
    expect(nextReference('2026-11', 1)).toBe('2026-12');
    expect(nextReference('2026-12', 1)).toBe('2027-01');
    expect(nextReference('2026-03', 0)).toBe('2026-03');
  });
});

describe('createSchoolContract', () => {
  it('cria DRAFT e grava idempotency + auditoria', async () => {
    const c = fakeClient(defaultRoute());
    const { contract, idempotentReplay } = await createSchoolContract(c, base);
    expect(idempotentReplay).toBe(false);
    expect(contract.status).toBe('DRAFT');
    expect(c.calls.some((q) => has(q, 'INSERT INTO school_contracts'))).toBe(true);
    expect(c.calls.some((q) => has(q, 'INSERT INTO school_contract_idempotency'))).toBe(true);
    expect(c.calls.some((q) => has(q, "INSERT INTO audit_records") && q.values?.[2] === 'create')).toBe(true);
  });
  it('enrollment inexistente → NotFoundError; não-ACTIVE → ContractRuleError', async () => {
    const c1 = fakeClient(defaultRoute({ 'AND state': () => ({ rows: [], rowCount: 0 }), 'FROM enrollments WHERE id = $1 AND tenant_id = $2': () => ({ rows: [], rowCount: 0 }) }));
    await expect(createSchoolContract(c1, base)).rejects.toThrow(NotFoundError);
    const c2 = fakeClient(defaultRoute({ 'AND state': () => ({ rows: [], rowCount: 0 }) }));
    await expect(createSchoolContract(c2, base)).rejects.toThrow('enrollment must be ACTIVE');
  });
  it('plano inexistente → NotFoundError', async () => {
    const c = fakeClient(defaultRoute({ 'FROM tuition_plans': () => ({ rows: [], rowCount: 0 }) }));
    await expect(createSchoolContract(c, base)).rejects.toThrow(NotFoundError);
  });
  it('idempotency replay mesmo payload → 200-style replay; payload ≠ → ConflictError', async () => {
    const c = fakeClient(defaultRoute({
      'FROM school_contract_idempotency': () => ({
        rows: [{ contract_id: 'c1', enrollment_id: 'e1', plan_id: 'p1', monthly_price_cents: 42000, installments: 3, start_reference: '2026-03' }],
        rowCount: 1,
      }),
    }));
    const r = await createSchoolContract(c, base);
    expect(r.idempotentReplay).toBe(true);
    expect(r.contract.id).toBe('c1');

    const c2 = fakeClient(defaultRoute({
      'FROM school_contract_idempotency': () => ({
        rows: [{ contract_id: 'c1', enrollment_id: 'e1', plan_id: 'p1', monthly_price_cents: 999, installments: 3, start_reference: '2026-03' }],
        rowCount: 1,
      }),
    }));
    await expect(createSchoolContract(c2, base)).rejects.toThrow(ConflictError);
  });
  it('ON CONFLICT sem row → enrollment já tem contrato → ConflictError', async () => {
    const c = fakeClient(defaultRoute({ 'INSERT INTO school_contracts': () => ({ rows: [], rowCount: 0 }) }));
    await expect(createSchoolContract(c, base)).rejects.toThrow('enrollment already has an open contract');
  });
});

describe('get/list', () => {
  it('get retorna contrato do tenant; ghost → NotFoundError', async () => {
    const c = fakeClient(defaultRoute());
    expect((await getSchoolContract(c, 'A', 'c1')).id).toBe('c1');
    const c2 = fakeClient(defaultRoute({ 'FROM school_contracts WHERE id = $1 AND tenant_id = $2': () => ({ rows: [], rowCount: 0 }) }));
    await expect(getSchoolContract(c2, 'A', 'x')).rejects.toThrow(NotFoundError);
  });
  it('lista apenas do tenant', async () => {
    const c = fakeClient(defaultRoute());
    expect((await listSchoolContracts(c as never as Pool, 'A'))).toHaveLength(1);
    expect(c.calls[0].text.includes('WHERE tenant_id = $1')).toBe(true);
  });
});

describe('activateSchoolContract', () => {
  it('gera installments com referências consecutivas e audita activate', async () => {
    vi.mocked(generateTuition).mockResolvedValue({ id: `t${Date.now()}` } as never);
    fakeTx = fakeClient(defaultRoute());
    const { contract, tuitions } = await activateSchoolContract({} as Pool, 'A', 'c1', 'u1');
    expect(contract.status).toBe('ACTIVE');
    expect(tuitions).toHaveLength(3);
    expect(vi.mocked(generateTuition).mock.calls.map(([, p]) => (p as { reference: string }).reference)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(fakeTx.calls.some((q) => has(q, 'INSERT INTO audit_records') && q.values?.[2] === 'activate')).toBe(true);
  });
  it('contrato não-DRAFT → ContractRuleError', async () => {
    fakeTx = fakeClient(defaultRoute({ 'FROM school_contracts WHERE id = $1 AND tenant_id = $2': () => ({ rows: [contractRow({ status: 'ACTIVE' })], rowCount: 1 }) }));
    await expect(activateSchoolContract({} as Pool, 'A', 'c1', 'u1')).rejects.toThrow('contract is not DRAFT');
  });
});

describe('cancelSchoolContract', () => {
  it('cancela apenas tuitions OPEN dentro das referências do contrato e audita cancel', async () => {
    vi.mocked(cancelTuition).mockResolvedValue({} as never);
    fakeTx = fakeClient(defaultRoute({ 'FROM school_contracts WHERE id = $1 AND tenant_id = $2': () => ({ rows: [contractRow({ status: 'ACTIVE' })], rowCount: 1 }) }));
    const { contract, canceledTuitions } = await cancelSchoolContract({} as Pool, 'A', 'c1', 'u1');
    expect(contract.status).toBe('CANCELED');
    // t1 (2026-03) e t2 (2026-04) dentro de [03,04,05]; t9 (2030-01) fora
    expect(canceledTuitions).toBe(2);
    expect(vi.mocked(cancelTuition).mock.calls.map((a) => a[2])).toEqual(['t1', 't2']);
    expect(fakeTx.calls.some((q) => has(q, 'INSERT INTO audit_records') && q.values?.[2] === 'cancel')).toBe(true);
  });
  it('DRAFT pode cancelar sem tocar tuitions; duplo cancel → ContractRuleError', async () => {
    fakeTx = fakeClient(defaultRoute());
    const r = await cancelSchoolContract({} as Pool, 'A', 'c1', 'u1');
    expect(r.canceledTuitions).toBe(0);
    expect(fakeTx.calls.some((q) => has(q, 'FROM tuitions WHERE tenant_id'))).toBe(false);

    fakeTx = fakeClient(defaultRoute({ 'FROM school_contracts WHERE id = $1 AND tenant_id = $2': () => ({ rows: [contractRow({ status: 'CANCELED' })], rowCount: 1 }) }));
    await expect(cancelSchoolContract({} as Pool, 'A', 'c1', 'u1')).rejects.toThrow('already canceled');
  });
});

describe('isolamento cross-tenant', () => {
  it('queries sempre filtram tenant', async () => {
    const c = fakeClient(defaultRoute());
    await getSchoolContract(c, 'B', 'c1').catch(() => undefined);
    expect(c.calls[0].text.includes('tenant_id = $2')).toBe(true);
  });
});

export { baseParams };
