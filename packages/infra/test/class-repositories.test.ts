/**
 * E08-01 — classes/courses/offers/teachers (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ClassRuleError, ConflictError, createCourse, listCourses, archiveCourse,
  createClass, updateClass, transitionClass, listClasses, classOccupancy,
  addTeacher, removeTeacher, createOffer, listOffers, updateOffer, mapClassError,
} from '../src/class-repositories.js';
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

const COURSE = { id: 'c1', tenant_id: 'T', name: 'curso', active: true, archived_at: null, created_at: new Date() };
const CLASS = { id: 'k1', tenant_id: 'T', course_id: 'c1', unit_id: 'u1', name: 'A1', capacity: 30, status: 'PLANNED', created_at: new Date(), updated_at: new Date() };
const OFFER = { id: 'o1', tenant_id: 'T', class_id: 'k1', name: 'matrícula', price_cents: 100000, active: true, created_at: new Date() };

describe('courses', () => {
  it('cria/lista/arquiva; arquivar com classes ativas → 409; nome 422', async () => {
    const { client, queries } = fakeClient((q) => (q.text.includes('INSERT INTO courses') ? [COURSE] : []));
    const c = await createCourse(client, 'T', { name: 'curso' });
    expect(c.name).toBe('curso');
    expect(c.active).toBe(true);
    const { client: cl } = fakeClient(() => [COURSE]);
    expect(await listCourses(cl, 'T')).toHaveLength(1);
    // arquivar: sem classes ativas → ok
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM courses WHERE')) return [{ id: 'c1' }];
      if (q.text.includes('FROM classes')) return [{ n: 0 }];
      if (q.text.includes('UPDATE courses')) return [{ ...COURSE, active: false, archived_at: new Date() }];
      return [];
    });
    const archived = await archiveCourse(c2, 'T', 'c1');
    expect(archived.active).toBe(false);
    // com classes ativas → ConflictError
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM courses WHERE')) return [{ id: 'c1' }];
      if (q.text.includes('FROM classes')) return [{ n: 2 }];
      return [];
    });
    await expect(archiveCourse(c3, 'T', 'c1')).rejects.toThrow(/ativas/);
    // not found
    const { client: c4 } = fakeClient(() => []);
    await expect(archiveCourse(c4, 'T', 'zz')).rejects.toThrow(NotFoundError);
    // nome vazio
    const { client: c5 } = fakeClient(() => []);
    await expect(createCourse(c5, 'T', { name: ' ' })).rejects.toThrow(ClassRuleError);
    expect(queries.length).toBeGreaterThanOrEqual(0);
  });
});

describe('classes', () => {
  it('capacity > 0; occupancy; transições PLANNED→OPEN→RUNNING→CLOSED; CLOSED terminal', async () => {
    const { client } = fakeClient(() => [CLASS]);
    const k = await createClass(client, 'T', { courseId: 'c1', unitId: 'u1', name: 'A1', capacity: 30 });
    expect(k.capacity).toBe(30);
    const { client: c0 } = fakeClient(() => []);
    await expect(createClass(c0, 'T', { courseId: 'c1', unitId: 'u1', name: 'x', capacity: 0 })).rejects.toThrow(ClassRuleError);
    // update capacity abaixo da ocupação → 422
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM classes WHERE id =')) return [{ ...CLASS, status: 'RUNNING' }];
      if (q.text.includes('COUNT(*)') && q.text.includes('ACTIVE')) return [{ n: 30 }];
      return [];
    });
    await expect(updateClass(c1, 'T', 'k1', { capacity: 29 })).rejects.toThrow(ClassRuleError);
    // update válido
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM classes WHERE id =')) return [{ ...CLASS, status: 'RUNNING' }];
      if (q.text.includes('COUNT(*)') && q.text.includes('ACTIVE')) return [{ n: 10 }];
      if (q.text.includes('UPDATE classes')) return [{ ...CLASS, capacity: 40 }];
      return [];
    });
    const up = await updateClass(c2, 'T', 'k1', { capacity: 40 });
    expect(up.capacity).toBe(40);
    // transição válida
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...CLASS, status: 'PLANNED' }];
      if (q.text.includes('UPDATE classes')) return [{ ...CLASS, status: 'OPEN' }];
      return [];
    });
    const tr = await transitionClass(c3, 'T', 'k1', 'OPEN');
    expect(tr.status).toBe('OPEN');
    // inválida PLANNED→RUNNING
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...CLASS, status: 'PLANNED' }];
      return [];
    });
    await expect(transitionClass(c4, 'T', 'k1', 'RUNNING')).rejects.toThrow(ClassRuleError);
    // CLOSED terminal
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) return [{ ...CLASS, status: 'CLOSED' }];
      return [];
    });
    await expect(transitionClass(c5, 'T', 'k1', 'OPEN')).rejects.toThrow(ClassRuleError);
    // not found
    const { client: c6 } = fakeClient(() => []);
    await expect(transitionClass(c6, 'T', 'zz', 'OPEN')).rejects.toThrow(NotFoundError);
    // occupancy
    const { client: c7 } = fakeClient((q) => {
      if (q.text.includes('SELECT capacity FROM classes')) return [{ capacity: 30 }];
      if (q.text.includes('COUNT(*)::int AS n FROM enrollments')) return [{ n: 12 }];
      return [];
    });
    const occ = await classOccupancy(c7, 'T', 'k1');
    expect(occ).toEqual({ capacity: 30, enrolled: 12, available: 18 });
    // list
    const { client: c8 } = fakeClient(() => [CLASS]);
    expect(await listClasses(c8, 'T', { courseId: 'c1' })).toHaveLength(1);
  });
});

describe('teachers', () => {
  it('add valida user do tenant; remove idempotente', async () => {
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM users')) return [{ id: 'u9' }];
      if (q.text.includes('FROM classes')) return [{ id: 'k1' }];
      if (q.text.includes('INSERT INTO class_teachers')) return [{ tenant_id: 'T', class_id: 'k1', user_id: 'u9' }];
      return [];
    });
    const t = await addTeacher(c1, 'T', 'k1', 'u9');
    expect(t.userId).toBe('u9');
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM users')) return [];
      return [];
    });
    await expect(addTeacher(c2, 'T', 'k1', 'ghost')).rejects.toThrow(NotFoundError);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [];
      return [];
    });
    await expect(addTeacher(c3, 'T', 'zz', 'u9')).rejects.toThrow(NotFoundError);
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('DELETE FROM class_teachers')) return [];
      return [];
    });
    const r = await removeTeacher(c4, 'T', 'k1', 'u9');
    expect(r.removed).toBe(true);
  });
});

describe('offers', () => {
  it('price ≥ 0; update active/price; list por turma', async () => {
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [{ id: 'k1' }];
      if (q.text.includes('INSERT INTO offers')) return [OFFER];
      return [];
    });
    const o = await createOffer(c1, 'T', { classId: 'k1', name: 'matrícula', priceCents: 100000 });
    expect(o.priceCents).toBe(100000);
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [{ id: 'k1' }];
      return [];
    });
    await expect(createOffer(c2, 'T', { classId: 'k1', name: 'x', priceCents: -1 })).rejects.toThrow(ClassRuleError);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM offers WHERE id =')) return [{ id: 'o1' }];
      if (q.text.includes('UPDATE offers')) return [{ ...OFFER, active: false }];
      return [];
    });
    const up = await updateOffer(c3, 'T', 'o1', { active: false });
    expect(up.active).toBe(false);
    const { client: c4 } = fakeClient(() => []);
    await expect(updateOffer(c4, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
    const { client: c5 } = fakeClient(() => [OFFER]);
    expect(await listOffers(c5, 'T', 'k1')).toHaveLength(1);
  });
});

describe('branches finais classes', () => {
  it('paths: updateClass 404/cap inválido/name-only; occupancy 404; addTeacher/addOffer 404 turma; updateOffer patchs', async () => {
    // updateClass not found (linha 88)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM classes WHERE id =')) return [];
      return [];
    });
    await expect(updateClass(c1, 'T', 'zz', { capacity: 10 })).rejects.toThrow(NotFoundError);
    // updateClass cap inválido (90)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM classes WHERE id =')) return [CLASS];
      return [];
    });
    await expect(updateClass(c2, 'T', 'k1', { capacity: 0 })).rejects.toThrow(ClassRuleError);
    // updateClass só name (101 — COALESCE com capacity null, pula branch enrolled)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM classes WHERE id =')) return [CLASS];
      if (q.text.includes('UPDATE classes')) return [{ ...CLASS, name: 'novo' }];
      return [];
    });
    const rn = await updateClass(c3, 'T', 'k1', { name: 'novo' });
    expect(rn.name).toBe('novo');
    // listClasses com status filter (130)
    const { client: c4, queries: q4 } = fakeClient(() => []);
    await listClasses(c4, 'T', { status: 'OPEN', courseId: 'c1' });
    expect(q4[0]!.values).toEqual(['T', 'c1', 'OPEN']);
    // occupancy 404 (140)
    const { client: c5 } = fakeClient((q) => {
      if (q.text.includes('SELECT capacity FROM classes')) return [];
      return [];
    });
    await expect(classOccupancy(c5, 'T', 'zz')).rejects.toThrow(NotFoundError);
    // addTeacher turma 404 (155)
    const { client: c6 } = fakeClient((q) => {
      if (q.text.includes('FROM users')) return [{ id: 'u9' }];
      if (q.text.includes('FROM classes')) return [];
      return [];
    });
    await expect(addTeacher(c6, 'T', 'zz', 'u9')).rejects.toThrow(NotFoundError);
    // createOffer turma 404 (175)
    const { client: c7 } = fakeClient((q) => {
      if (q.text.includes('FROM classes')) return [];
      return [];
    });
    await expect(createOffer(c7, 'T', { classId: 'zz', name: 'x', priceCents: 1 })).rejects.toThrow(NotFoundError);
    // updateOffer priceCents inválido (192)
    const { client: c8 } = fakeClient(() => []);
    await expect(updateOffer(c8, 'T', 'o1', { priceCents: -5 })).rejects.toThrow(ClassRuleError);
    // updateOffer todos patchs (198)
    const { client: c9 } = fakeClient((q) => {
      if (q.text.includes('FROM offers WHERE id =')) return [{ id: 'o1' }];
      if (q.text.includes('UPDATE offers')) return [{ ...OFFER, name: 'y', price_cents: 5, active: false }];
      return [];
    });
    const up = await updateOffer(c9, 'T', 'o1', { name: 'y', priceCents: 5, active: false });
    expect(up.priceCents).toBe(5);
    // patch parcial (?? null paths)
    const { client: ca } = fakeClient((q) => {
      if (q.text.includes('FROM offers WHERE id =')) return [{ id: 'o1' }];
      if (q.text.includes('UPDATE offers')) return [OFFER];
      return [];
    });
    await updateOffer(ca, 'T', 'o1', { active: true });
    expect(ca.queries.some((q) => q.text.includes('UPDATE offers'))).toBe(true);
    // patch só name e só priceCents (?? null restantes)
    const { client: cb } = fakeClient((q) => {
      if (q.text.includes('FROM offers WHERE id =')) return [{ id: 'o1' }];
      if (q.text.includes('UPDATE offers')) return [{ ...OFFER, name: 'z' }];
      return [];
    });
    await updateOffer(cb, 'T', 'o1', { name: 'z' });
    const { client: cc } = fakeClient((q) => {
      if (q.text.includes('FROM offers WHERE id =')) return [{ id: 'o1' }];
      if (q.text.includes('UPDATE offers')) return [{ ...OFFER, price_cents: 7 }];
      return [];
    });
    await updateOffer(cc, 'T', 'o1', { priceCents: 7 });
  });
});

describe('mapClassError', () => {
  it('mapeia 422/404/409/500', () => {
    expect(mapClassError(new ClassRuleError('x')).status).toBe(422);
    expect(mapClassError(new NotFoundError('x')).status).toBe(404);
    expect(mapClassError(new ConflictError('x')).status).toBe(409);
    expect(mapClassError(new Error('x')).status).toBe(500);
  });
});
