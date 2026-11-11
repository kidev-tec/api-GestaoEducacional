/**
 * E13-01 — catálogo global de módulos vendáveis com grafo de dependências.
 */
import { NotFoundError } from './people-repositories.js';

export class CatalogRuleError extends Error {}
export class CatalogConflictError extends Error { override name = 'CatalogConflictError'; }
type Pg = import('pg').Pool | import('pg').PoolClient;

export function mapCatalogError(e: unknown): { status: number } {
  if (e instanceof CatalogRuleError) return { status: 422 };
  if (e instanceof CatalogConflictError) return { status: 409 };
  if (e instanceof NotFoundError) return { status: 404 };
  const code = (e as { code?: string }).code;
  if (code === '23505') return { status: 409 }; // unique violation
  if (code === 'P0002') return { status: 404 }; // no data
  return { status: 500 };
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

export type CatalogModule = {
  key: string; name: string; tier: 'FREE' | 'INCLUDED' | 'PAID';
  priceCents: number; requires: string[]; active: boolean;
};
type ModRow = Record<string, unknown> & {
  key: string; name: string; tier: CatalogModule['tier']; price_cents: number;
  requires: string[]; active: boolean;
};
const toModule = (r: ModRow): CatalogModule => ({
  key: r.key, name: r.name, tier: r.tier, priceCents: r.price_cents, requires: r.requires, active: r.active,
});

async function loadAllRows(c: Pg): Promise<Array<{ key: string; requires: string[]; active: boolean }>> {
  const r = await c.query('SELECT key, requires, active FROM module_catalog');
  return r.rows as Array<{ key: string; requires: string[]; active: boolean }>;
}

/** R3: grafo acíclico incluindo o nó em análise. */
function assertAcyclic(all: Array<{ key: string; requires: string[] }>, key: string, requires: string[]): void {
  const graph = new Map<string, string[]>(all.map((m) => [m.key, m.requires]));
  graph.set(key, requires);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) throw new CatalogRuleError('ciclo de dependências detectado');
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dep of graph.get(node)!) visit(dep);
    visiting.delete(node);
    visited.add(node);
  };
  visit(key);
}

/** R1: toda dependência existe e está ativa. */
function assertDepsExist(all: Array<{ key: string; active: boolean }>, requires: string[]): void {
  const map = new Map(all.map((m) => [m.key, m.active]));
  for (const dep of requires) {
    if (!map.has(dep)) throw new CatalogRuleError(`dependência inexistente: ${dep}`);
    if (!map.get(dep)) throw new CatalogRuleError(`dependência inativa: ${dep}`);
  }
}

const assertTierPrice = (tier: 'FREE' | 'INCLUDED' | 'PAID', priceCents: number): void => {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new CatalogRuleError('price_cents deve ser inteiro >= 0');
  if (tier === 'FREE' && priceCents !== 0) throw new CatalogRuleError('módulo FREE deve ter preço 0');
};

export async function listModules(c: Pg, filter: { activeOnly?: boolean }): Promise<CatalogModule[]> {
  const sql = 'SELECT key, name, tier, price_cents, requires, active FROM module_catalog'
    + (filter.activeOnly ? ' WHERE active = true' : '')
    + ' ORDER BY created_at';
  const r = await c.query(sql);
  return (r.rows as ModRow[]).map(toModule);
}

export async function createModule(c: Pg, input: {
  key: string; name: string; tier: 'FREE' | 'INCLUDED' | 'PAID'; priceCents: number; requires: string[];
}): Promise<CatalogModule> {
  if (!KEY_RE.test(input.key)) throw new CatalogRuleError('key deve ser slug (a-z0-9_)');
  assertTierPrice(input.tier, input.priceCents);
  const all = await loadAllRows(c);
  if (all.some((m) => m.key === input.key)) throw new CatalogConflictError('módulo já existe no catálogo');
  if (input.requires.includes(input.key)) throw new CatalogRuleError('ciclo: módulo requer a si mesmo');
  assertDepsExist(all, input.requires);
  assertAcyclic(all, input.key, input.requires);
  const r = await c.query(
    `INSERT INTO module_catalog (key, name, tier, price_cents, requires)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING key, name, tier, price_cents, requires, active`,
    [input.key, input.name, input.tier, input.priceCents, input.requires],
  );
  return toModule(r.rows[0] as ModRow);
}

export async function updateModule(c: Pg, key: string, patch: {
  name?: string; tier?: 'FREE' | 'INCLUDED' | 'PAID'; priceCents?: number; requires?: string[]; active?: boolean;
}): Promise<CatalogModule> {
  const cur = await c.query('SELECT key, name, tier, price_cents, requires, active FROM module_catalog WHERE key = $1', [key]);
  if (!cur.rowCount) throw new NotFoundError('módulo não encontrado');
  const curMod = toModule(cur.rows[0] as ModRow);
  const tier = patch.tier ?? curMod.tier;
  const priceCents = patch.priceCents ?? curMod.priceCents;
  const requires = patch.requires ?? curMod.requires;
  assertTierPrice(tier, priceCents);
  const all = await loadAllRows(c);
  if (patch.requires != null) {
    if (requires.includes(key)) throw new CatalogRuleError('ciclo: módulo requer a si mesmo');
    assertDepsExist(all.filter((m) => m.key !== key), requires);
    assertAcyclic(all.filter((m) => m.key !== key), key, requires);
  }
  const r = await c.query(
    `UPDATE module_catalog SET
       name = COALESCE($2, name),
       tier = COALESCE($3, tier),
       price_cents = COALESCE($4, price_cents),
       requires = COALESCE($5, requires),
       active = COALESCE($6, active),
       updated_at = now()
     WHERE key = $1
     RETURNING key, name, tier, price_cents, requires, active`,
    [key, patch.name ?? null, patch.tier ?? null, patch.priceCents ?? null, patch.requires ?? null, patch.active ?? null],
  );
  return toModule(r.rows[0] as ModRow);
}

/** R1 auxiliar: dependentes diretos (quem lista key em requires). */
export async function moduleDependents(c: Pg, key: string): Promise<string[]> {
  const r = await c.query('SELECT key FROM module_catalog WHERE requires && $1', [[key]]);
  return (r.rows as Array<{ key: string }>).map((x) => x.key);
}
