/**
 * E13-01 — catálogo de módulos com dependências (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CatalogRuleError, listModules, createModule, updateModule, moduleDependents, mapCatalogError,
} from '../src/module-catalog-repositories.js';
import { CatalogConflictError } from '../src/module-catalog-repositories.js';
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

const CORE = { key: 'core', name: 'Core', tier: 'FREE', price_cents: 0, requires: [], active: true };
const CRM = { key: 'crm', name: 'CRM', tier: 'PAID', price_cents: 9900, requires: ['secretaria'], active: true };
const IA = { key: 'ia', name: 'IA', tier: 'PAID', price_cents: 24900, requires: ['bi'], active: true };

describe('listModules', () => {
  it('lista todos; só ativos quando filter', async () => {
    const { client, queries } = fakeClient(() => [CORE, CRM]);
    const all = await listModules(client, {});
    expect(all).toHaveLength(2);
    expect(queries[0]!.values).toEqual([]);
    const { client: c1, queries: q1 } = fakeClient(() => [CORE]);
    await listModules(c1, { activeOnly: true });
    expect(q1[0]!.text).toContain('active = true');
  });
});

describe('createModule (R1/R3/R4)', () => {
  it('valida slug/tier/preço; dependência inexistente → 422; ciclo direto → 422', async () => {
    const catalog = [CORE, { key: 'secretaria', requires: [], active: true }, { ...CRM, requires: ['secretaria'] }];
    const { client } = fakeClient((q) => {
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) {
        return catalog.map((m) => ({ key: m.key, requires: m.requires, active: true }));
      }
      if (q.text.includes('INSERT INTO module_catalog')) return [{ key: 'academico', name: 'Acadêmico', tier: 'PAID', price_cents: 14900, requires: ['secretaria'], active: true }];
      return [];
    });
    const m = await createModule(client, { key: 'academico', name: 'Acadêmico', tier: 'PAID', priceCents: 14900, requires: ['secretaria'] });
    expect(m.priceCents).toBe(14900);
    // slug inválido
    const { client: c0 } = fakeClient(() => []);
    await expect(createModule(c0, { key: 'Bad Key', name: 'x', tier: 'PAID', priceCents: 100, requires: [] })).rejects.toThrow(CatalogRuleError);
    // FREE com preço > 0
    await expect(createModule(c0, { key: 'livre', name: 'x', tier: 'FREE', priceCents: 500, requires: [] })).rejects.toThrow(/FREE/);
    // price negativo
    await expect(createModule(c0, { key: 'neg', name: 'x', tier: 'PAID', priceCents: -1, requires: [] })).rejects.toThrow(CatalogRuleError);
    // dependência inexistente
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('SELECT key FROM module_catalog')) return [{ key: 'core' }];
      return [];
    });
    await expect(createModule(c1, { key: 'novo', name: 'x', tier: 'PAID', priceCents: 100, requires: ['ghost'] })).rejects.toThrow(/dependência/);
    // ciclo: novo módulo A requer B, e B (novo no mesmo insert?) — ciclo testado via requires que referencia o próprio key
    await expect(createModule(c1, { key: 'self', name: 'x', tier: 'PAID', priceCents: 100, requires: ['self'] })).rejects.toThrow(/ciclo|dependência/);
    // duplicate key → 409 (fake lança via pg? simulamos com unique violation no INSERT? fake não valida UNIQUE;
    // skip: conflito tratado no banco real — mas mapear erro 23505 → 409 via mapCatalogError)
  });
});

describe('updateModule (R1/R2)', () => {
  it('desativar; preço; requires com ciclo → 422; 404', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes("FROM module_catalog WHERE key =")) return [{ ...CRM }];
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [CORE, { ...CRM, key: 'crm2', requires: ['secretaria'] }];
      if (q.text.includes('UPDATE module_catalog')) return [{ ...CRM, active: false }];
      return [];
    });
    const up = await updateModule(client, 'crm', { active: false });
    expect(up.active).toBe(false);
    // preço em PAID
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes("FROM module_catalog WHERE key =")) return [{ ...CRM }];
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [CORE, CRM, IA];
      if (q.text.includes('UPDATE module_catalog')) return [{ ...CRM, price_cents: 12900 }];
      return [];
    });
    const pr = await updateModule(c1, 'crm', { priceCents: 12900 });
    expect(pr.priceCents).toBe(12900);
    // FREE não pode ter preço
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes("FROM module_catalog WHERE key =")) return [{ ...CORE }];
      return [];
    });
    await expect(updateModule(c2, 'core', { priceCents: 100 })).rejects.toThrow(/FREE/);
    // ciclo: mudar requires de secretaria p/ incluir crm (que requer secretaria) — ciclo detectado
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes("FROM module_catalog WHERE key =")) return [{ ...CRM }];
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [CORE, CRM];
      return [];
    });
    await expect(updateModule(c3, 'secretaria', { requires: ['crm'] })).rejects.toThrow(/ciclo/);
    // 404
    const { client: c4 } = fakeClient(() => []);
    await expect(updateModule(c4, 'zz', {})).rejects.toThrow(/não encontrado/);
  });
});

describe('moduleDependents (R1)', () => {
  it('lista quem depende diretamente', async () => {
    const { client, queries } = fakeClient(() => [IA]);
    const deps = await moduleDependents(client, 'bi');
    expect(deps).toEqual(['ia']);
    expect(queries[0]!.text).toContain('requires &&');
    const { client: c1 } = fakeClient(() => []);
    expect(await moduleDependents(c1, 'nobody')).toEqual([]);
  });
});

describe('branches finais catalog', () => {
  it('paths: NotFoundError 404; visited no grafo; dep inexistente e inativa; duplicate; self-cycle; update self', async () => {
    // NotFoundError direto (11)
    const nf = new NotFoundError('x');
    expect(mapCatalogError(nf).status).toBe(404);
    // grafo com nó revisitado (45): A requer CORE duas vezes via cadeia
    const { client } = fakeClient((q) => {
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) {
        return [
          { key: 'core', requires: [], active: true },
          { key: 'a', requires: ['core'], active: true },
          { key: 'b', requires: ['a', 'core'], active: true },
        ];
      }
      if (q.text.includes('INSERT INTO module_catalog')) return [{ key: 'c', name: 'C', tier: 'PAID', price_cents: 1, requires: ['b'], active: true }];
      return [];
    });
    const ok = await createModule(client, { key: 'c', name: 'C', tier: 'PAID', priceCents: 1, requires: ['b'] });
    expect(ok.key).toBe('c');
    // dep inexistente (58) já testado; dep INATIVA (59)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) {
        return [{ key: 'core', requires: [], active: false }];
      }
      return [];
    });
    await expect(createModule(c1, { key: 'x', name: 'X', tier: 'PAID', priceCents: 1, requires: ['core'] })).rejects.toThrow(/inativa/);
    // duplicate (82)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [{ key: 'dupe', requires: [], active: true }];
      return [];
    });
    await expect(createModule(c2, { key: 'dupe', name: 'X', tier: 'PAID', priceCents: 1, requires: [] })).rejects.toThrow(/já existe/);
    // self-cycle create (84)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [{ key: 'core', requires: [], active: true }];
      return [];
    });
    await expect(createModule(c3, { key: 'self', name: 'X', tier: 'PAID', priceCents: 1, requires: ['self'] })).rejects.toThrow(/si mesmo/);
    // update self-cycle (108)
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes("FROM module_catalog WHERE key =")) return [{ key: 'a', name: 'A', tier: 'PAID', price_cents: 1, requires: [], active: true }];
      if (q.text.includes('SELECT key, requires, active FROM module_catalog')) return [{ key: 'a', requires: [], active: true }];
      return [];
    });
    await expect(updateModule(c4, 'a', { requires: ['a'] })).rejects.toThrow(/si mesmo/);
  });
});

describe('mapCatalogError', () => {
  it('mapeia 422/409/404/500', () => {
    expect(mapCatalogError(new CatalogRuleError('x')).status).toBe(422);
    expect(mapCatalogError(new CatalogConflictError('x')).status).toBe(409);
    const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(mapCatalogError(conflict).status).toBe(409);
    const nf = Object.assign(new Error('not found'), { code: 'P0002' });
    expect(mapCatalogError(nf).status).toBe(404);
    expect(mapCatalogError(new Error('x')).status).toBe(500);
  });
});
