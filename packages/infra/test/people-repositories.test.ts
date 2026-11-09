/**
 * E05-A — Testes unitários de people-repositories com PoolClient/Pool fake.
 * Cobre: insertUnit (raiz/com pai/ciclo/pai de outro tenant/inexistente), assertNoCycle
 * (limite de profundidade), insertPerson (unidade própria/de outro), listPeople (filtros),
 * getPerson, updatePerson (merge de campos, troca de unidade), linkGuardian (todas as
 * regras) e listGuardians.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertNoCycle,
  ConflictError,
  GuardianRuleError,
  getPerson,
  insertPerson,
  insertUnit,
  linkGuardian,
  listGuardians,
  listPeople,
  listUnits,
  NotFoundError,
  UnitCycleError,
  updatePerson,
} from '../src/people-repositories.js';

type Res = { rows: Record<string, unknown>[]; rowCount: number | null };
type Q = { text: string; values?: unknown[] };

/** Fake que responde por predicado sobre (text, values). */
function fakeClient(handler: (q: Q) => Res | Promise<Res>) {
  const calls: Q[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    const q = { text, values };
    calls.push(q);
    return await handler(q);
  });
  return { query, calls } as never as Parameters<typeof insertUnit>[0] & { calls: Q[]; query: ReturnType<typeof vi.fn> };
}

const unitRow = (id: string, parentId: string | null, tenant = 'A'): Res => ({
  rows: [{ id, tenant_id: tenant, name: 'N', parent_id: parentId }], rowCount: 1,
});
const empty: Res = { rows: [], rowCount: 0 };

describe('insertUnit', () => {
  it('cria unidade raiz sem consultar pai', async () => {
    const client = fakeClient(() => unitRow('u1', null));
    const unit = await insertUnit(client, { tenantId: 'A', name: 'Sede' });
    expect(unit.parentId).toBeNull();
  });

  it('cria unidade com pai válido do mesmo tenant', async () => {
    const client = fakeClient((q) => {
      if (q.text.includes('SELECT id, tenant_id, parent_id FROM units')) return unitRow('parent1', null);
      if (q.text.includes('SELECT parent_id FROM units')) return { rows: [{ parent_id: null }], rowCount: 1 };
      return unitRow('u2', 'parent1');
    });
    const unit = await insertUnit(client, { tenantId: 'A', name: 'Filial', parentId: 'parent1' });
    expect(unit.parentId).toBe('parent1');
  });

  it('pai inexistente → NotFoundError', async () => {
    const client = fakeClient(() => empty);
    await expect(insertUnit(client, { tenantId: 'A', name: 'X', parentId: 'ghost' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pai de outro tenant → NotFoundError (sem referenciar)', async () => {
    const client = fakeClient(() => unitRow('p1', null, 'B'));
    await expect(insertUnit(client, { tenantId: 'A', name: 'X', parentId: 'p1' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('assertNoCycle', () => {
  const chainClient = (parents: Record<string, string | null>) =>
    fakeClient((q) => {
      const id = q.values?.[0] as string;
      const parent = parents[id];
      return parent === undefined ? empty : { rows: [{ parent_id: parent }], rowCount: 1 };
    });

  it('cadeia normal sem ciclo termina em null', async () => {
    const client = chainClient({ a: 'b', b: null });
    await expect(assertNoCycle(client, 'A', 'a', null)).resolves.toBeUndefined();
  });

  it('detecta ciclo quando a cadeia volta ao excludeId', async () => {
    const client = chainClient({ a: 'b', b: 'a' });
    await expect(assertNoCycle(client, 'A', 'b', 'a')).rejects.toBeInstanceOf(UnitCycleError);
  });

  it('cadeia sem raiz após MAX_UNIT_DEPTH → UnitCycleError', async () => {
    // cadeia infinita: todo id tem pai = ele+1 (nunca null)
    const client = fakeClient((q) => {
      const id = q.values?.[0] as string;
      return { rows: [{ parent_id: id + 'x' }], rowCount: 1 };
    });
    await expect(assertNoCycle(client, 'A', 'start', null)).rejects.toBeInstanceOf(UnitCycleError);
  });

  it('unit que sumiu da cadeia → NotFoundError', async () => {
    const client = fakeClient(() => empty);
    await expect(assertNoCycle(client, 'A', 'missing', null)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('insertPerson / listPeople / getPerson / updatePerson', () => {
  const personRow = (over: Record<string, unknown> = {}): Res => ({
    rows: [{ id: 'p1', tenant_id: 'A', unit_id: 'u1', kind: 'STUDENT', name: 'Ana', document: null, email: null, phone: null, active: true, ...over }],
    rowCount: 1,
  });

  it('insertPerson valida unidade do mesmo tenant', async () => {
    const ok = fakeClient((q) => (q.text.startsWith('SELECT id, tenant_id FROM units') ? unitRow('u1', null) : personRow()));
    await expect(insertPerson(ok, { tenantId: 'A', unitId: 'u1', kind: 'STUDENT', name: 'Ana' })).resolves.toMatchObject({ name: 'Ana' });
    const bad = fakeClient((q) => (q.text.startsWith('SELECT id, tenant_id FROM units') ? unitRow('u1', null, 'B') : empty));
    await expect(insertPerson(bad, { tenantId: 'A', unitId: 'u1', kind: 'STUDENT', name: 'Ana' })).rejects.toBeInstanceOf(NotFoundError);
    const ghost = fakeClient(() => empty);
    await expect(insertPerson(ghost, { tenantId: 'A', unitId: 'nope', kind: 'STUDENT', name: 'Ana' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listPeople monta cláusulas com todos os filtros', async () => {
    const pool = fakeClient(() => ({ rows: [], rowCount: 0 })) as never as Parameters<typeof listPeople>[0];
    await listPeople(pool, 'A', { kind: 'STUDENT', unitId: 'u1', nameQuery: 'an' });
    // 3 filtros + tenant = 4 placeholders
    const text = (pool as unknown as { calls: Q[] }).calls[0].text;
    expect(text).toContain('kind = $2');
    expect(text).toContain('unit_id = $3');
    expect(text).toContain('name ILIKE $4');
    await listPeople(pool, 'A', {});
    // sem filtros: só tenant — nenhuma cláusula extra além de tenant_id
    const bare = (pool as unknown as { calls: Q[] }).calls[1].text;
    expect(bare).not.toContain('kind = $');
    expect(bare).not.toContain('unit_id = $');
    expect(bare).not.toContain('ILIKE');
  });

  it('getPerson lança NotFound quando não existe', async () => {
    const pool = fakeClient(() => empty) as never as Parameters<typeof getPerson>[0];
    await expect(getPerson(pool, 'A', 'p1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updatePerson faz merge com existente e valida nova unidade', async () => {
    const client = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, tenant_id, unit_id')) return personRow();
      if (q.text.startsWith('SELECT id, tenant_id FROM units')) return unitRow('u9', null);
      return personRow({ name: 'Ana Updated', unit_id: 'u9', active: false });
    });
    const updated = await updatePerson(client, 'A', 'p1', { name: 'Ana Updated', unitId: 'u9', active: false });
    expect(updated.name).toBe('Ana Updated');
    expect(updated.active).toBe(false);
    const badUnit = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, tenant_id, unit_id')) return personRow();
      return empty;
    });
    await expect(updatePerson(badUnit, 'A', 'p1', { unitId: 'ghost' })).rejects.toBeInstanceOf(NotFoundError);
    // unidade de outro tenant na troca → NotFound (não referenciar)
    const otherTenantUnit = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, tenant_id, unit_id')) return personRow();
      return unitRow('uB', null, 'B');
    });
    await expect(updatePerson(otherTenantUnit, 'A', 'p1', { unitId: 'uB' })).rejects.toBeInstanceOf(NotFoundError);
    // patch com todos os campos nulláveis explicitamente null (limpa document/email/phone)
    const clear = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, tenant_id, unit_id')) return personRow({ document: 'doc', email: 'e@x', phone: '123' });
      return personRow({ document: null, email: null, phone: null });
    });
    const cleared = await updatePerson(clear, 'A', 'p1', { document: null, email: null, phone: null, active: undefined });
    expect(cleared.document).toBeNull();
    expect(cleared.active).toBe(true);
  });
});

describe('linkGuardian / listGuardians', () => {
  const guardian = { id: 'g1', tenant_id: 'A', unit_id: 'u1', kind: 'GUARDIAN', name: 'Bob', document: null, email: null, phone: null, active: true };
  const student = { id: 's1', tenant_id: 'A', unit_id: 'u1', kind: 'STUDENT', name: 'Ana', document: null, email: null, phone: null, active: true };

  function guardianClient(opts: { dup?: boolean; guardian?: Record<string, unknown>; student?: Record<string, unknown> } = {}) {
    return fakeClient((q) => {
      if (q.text.includes('WHERE id = $1 AND tenant_id = $2')) {
        const id = q.values?.[0] as string;
        const row = id === 'g1' ? (opts.guardian ?? guardian) : (opts.student ?? student);
        return { rows: [row], rowCount: 1 };
      }
      if (q.text.includes('FROM guardianships WHERE')) {
        return opts.dup ? { rows: [{ id: 'dup' }], rowCount: 1 } : empty;
      }
      return { rows: [{ id: 'new' }], rowCount: 1 };
    });
  }

  it('vincula responsável válido', async () => {
    await expect(linkGuardian(guardianClient(), { tenantId: 'A', studentId: 's1', guardianId: 'g1', relation: 'mother' })).resolves.toBeUndefined();
  });

  it.each([
    ['guardian inativo', { guardian: { ...guardian, active: false } }, 'inactive'],
    ['student inativo', { student: { ...student, active: false } }, 'inactive'],
    ['kind errado do guardião', { guardian: { ...guardian, kind: 'STAFF' } }, 'kind GUARDIAN'],
    ['kind errado do aluno', { student: { ...student, kind: 'STAFF' } }, 'kind STUDENT'],
  ])('%s → GuardianRuleError', async (_label, opts, msg) => {
    await expect(linkGuardian(guardianClient(opts), { tenantId: 'A', studentId: 's1', guardianId: 'g1', relation: 'r' }))
      .rejects.toSatisfy((e: Error) => e instanceof GuardianRuleError && e.message.includes(msg));
  });

  it('duplicata → ConflictError (idempotência defensiva antes do UNIQUE)', async () => {
    await expect(linkGuardian(guardianClient({ dup: true }), { tenantId: 'A', studentId: 's1', guardianId: 'g1', relation: 'r' }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('listGuardians valida student e faz join por student do tenant', async () => {
    let call = 0;
    const pool = fakeClient(() => {
      call += 1;
      return call === 1 ? { rows: [student], rowCount: 1 } : { rows: [guardian], rowCount: 1 };
    }) as never as Parameters<typeof listGuardians>[0];
    const list = await listGuardians(pool, 'A', 's1');
    expect(list).toHaveLength(1);
    expect((pool as unknown as { calls: Q[] }).calls[1].text).toContain('JOIN people');
    // student inexistente/outro tenant → NotFound (não lista vazia)
    const gone = fakeClient(() => empty) as never as Parameters<typeof listGuardians>[0];
    await expect(listGuardians(gone, 'A', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    // student com kind errado → GuardianRuleError
    const notStudent = fakeClient(() => ({ rows: [{ ...student, kind: 'STAFF' }], rowCount: 1 })) as never as Parameters<typeof listGuardians>[0];
    await expect(listGuardians(notStudent, 'A', 's1')).rejects.toBeInstanceOf(GuardianRuleError);
  });
});

describe('listUnits', () => {
  it('lista unidades ordenadas do tenant', async () => {
    const pool = fakeClient(() => ({ rows: [{ id: 'u1', tenant_id: 'A', name: 'B', parent_id: null }], rowCount: 1 })) as never as Parameters<typeof listUnits>[0];
    const list = await listUnits(pool, 'A');
    expect(list[0].name).toBe('B');
    expect((pool as unknown as { calls: Q[] }).calls[0].text).toContain('ORDER BY');
  });
});
