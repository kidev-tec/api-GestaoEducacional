/**
 * E13-02 — entitlements por tenant: licença de módulos do catálogo com seats, período e trilha.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class EntitlementRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapEntitlementError(e: unknown): { status: number } {
  if (e instanceof EntitlementRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

type Entitlement = {
  id: string; tenantId: string; moduleKey: string; seats: number | null; active: boolean;
  startsAt: string | null; endsAt: string | null;
};
type Row = Record<string, unknown> & {
  id: string; tenant_id: string; module_key: string; seats: number | null; active: boolean;
  starts_at: string | Date | null; ends_at: string | Date | null;
};
const iso = (v: string | Date | null): string | null => (v ? new Date(v).toISOString().slice(0, 10) : null);
const toEnt = (r: Row): Entitlement => ({
  id: r.id, tenantId: r.tenant_id, moduleKey: r.module_key, seats: r.seats, active: r.active,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
});

type CatalogModule = { key: string; requires: string[]; active: boolean };
async function loadCatalog(c: PoolClient): Promise<Map<string, CatalogModule>> {
  const r = await c.query('SELECT key, requires, active FROM module_catalog');
  const map = new Map<string, CatalogModule>();
  for (const row of r.rows as Array<{ key: string; requires: string[]; active: boolean }>) {
    map.set(row.key, { key: row.key, requires: row.requires ?? [], active: row.active });
  }
  return map;
}

async function recordEvent(c: PoolClient, tenantId: string, moduleKey: string, action: string, seats: number | null, note?: string): Promise<void> {
  await c.query(
    'INSERT INTO entitlement_events (id, tenant_id, module_key, action, seats, note) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), tenantId, moduleKey, action, seats, note ?? null],
  );
}

/** Dependências concedidas e ativas para o tenant (R4). */
async function grantedDeps(c: PoolClient, tenantId: string, requires: string[]): Promise<Set<string>> {
  if (requires.length === 0) return new Set();
  const r = await c.query(
    'SELECT module_key FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = ANY($2::text[]) AND active = true',
    [tenantId, requires],
  );
  return new Set((r.rows as Array<{ module_key: string }>).map((x) => x.module_key));
}

/** R1-R2: concede/reativa módulo p/ tenant. Idempotente por (tenant, module). */
export async function grantEntitlement(c: PoolClient, tenantId: string, input: {
  moduleKey: string; seats?: number; startsAt?: string; endsAt?: string; note?: string;
}): Promise<Entitlement> {
  if (input.seats !== undefined && input.seats !== null && input.seats < 1) throw new EntitlementRuleError('seats deve ser >= 1');
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) throw new EntitlementRuleError('período inválido: ends_at antes de starts_at');
  const catalog = await loadCatalog(c);
  const mod = catalog.get(input.moduleKey);
  if (!mod || !mod.active) throw new NotFoundError('módulo não encontrado ou inativo no catálogo');
  const deps = await grantedDeps(c, tenantId, mod.requires);
  const missing = mod.requires.filter((d) => !deps.has(d));
  if (missing.length > 0) throw new EntitlementRuleError(`dependências não concedidas: ${missing.join(', ')}`);
  const existing = await c.query(
    'SELECT * FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2',
    [tenantId, input.moduleKey],
  );
  let row: Row;
  if (existing.rowCount) {
    const upd = await c.query(
      `UPDATE tenant_entitlements SET active = true, seats = COALESCE($3, seats),
         starts_at = COALESCE($4, starts_at), ends_at = COALESCE($5, ends_at), updated_at = now()
       WHERE tenant_id = $1 AND module_key = $2 RETURNING *`,
      [tenantId, input.moduleKey, input.seats ?? null, input.startsAt ?? null, input.endsAt ?? null],
    );
    row = upd.rows[0] as Row;
    await recordEvent(c, tenantId, input.moduleKey, input.seats !== undefined ? 'SEATS_CHANGED' : 'ACTIVATED', input.seats ?? null, input.note);
  } else {
    const ins = await c.query(
      `INSERT INTO tenant_entitlements (id, tenant_id, module_key, seats, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [randomUUID(), tenantId, input.moduleKey, input.seats ?? null, input.startsAt ?? null, input.endsAt ?? null],
    );
    row = ins.rows[0] as Row;
    await recordEvent(c, tenantId, input.moduleKey, 'GRANTED', input.seats ?? null, input.note);
  }
  return toEnt(row);
}

/** R3: altera seats/active; trilha registra cada mudança. Redução de seats é permitida (não bloqueia dados). */
export async function updateEntitlement(c: PoolClient, tenantId: string, moduleKey: string, input: {
  seats?: number; active?: boolean; note?: string;
}): Promise<Entitlement> {
  if (input.seats !== undefined && input.seats !== null && input.seats < 1) throw new EntitlementRuleError('seats deve ser >= 1');
  const cur = await c.query('SELECT * FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2', [tenantId, moduleKey]);
  if (!cur.rowCount) throw new NotFoundError('entitlement não encontrado');
  let row = cur.rows[0] as Row;
  if (input.seats !== undefined) {
    const upd = await c.query('UPDATE tenant_entitlements SET seats = $3, updated_at = now() WHERE tenant_id = $1 AND module_key = $2 RETURNING *', [tenantId, moduleKey, input.seats]);
    row = upd.rows[0] as Row;
    await recordEvent(c, tenantId, moduleKey, 'SEATS_CHANGED', input.seats, input.note);
  }
  if (input.active !== undefined) {
    const upd = await c.query(`UPDATE tenant_entitlements SET active = $3, updated_at = now() WHERE tenant_id = $1 AND module_key = $2 RETURNING *`, [tenantId, moduleKey, input.active]);
    row = upd.rows[0] as Row;
    await recordEvent(c, tenantId, moduleKey, input.active ? 'ACTIVATED' : 'REVOKED', null, input.note);
  }
  return toEnt(row);
}

/** R4: módulo ativo, dentro do período e com dependências concedidas. */
export async function hasEntitlement(c: Pg, tenantId: string, moduleKey: string): Promise<boolean> {
  const r = await c.query('SELECT * FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2', [tenantId, moduleKey]);
  if (!r.rowCount) throw new NotFoundError('entitlement não encontrado');
  const ent = toEnt(r.rows[0] as Row);
  if (!ent.active) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (ent.startsAt && today < ent.startsAt) return false;
  if (ent.endsAt && today > ent.endsAt) return false;
  const catalog = await loadCatalog(c as PoolClient);
  const mod = catalog.get(moduleKey);
  if (!mod) throw new NotFoundError('módulo não encontrado no catálogo');
  const deps = await grantedDeps(c as PoolClient, tenantId, mod.requires);
  return mod.requires.every((d) => deps.has(d));
}

export async function listEntitlements(c: Pg, tenantId: string): Promise<Entitlement[]> {
  const r = await c.query('SELECT * FROM tenant_entitlements WHERE tenant_id = $1 ORDER BY module_key', [tenantId]);
  return (r.rows as Row[]).map(toEnt);
}

export async function entitlementAudit(c: Pg, tenantId: string, moduleKey: string): Promise<Array<{ action: string; seats: number | null; note: string | null; createdAt: Date }>> {
  const r = await c.query(
    'SELECT action, seats, note, created_at FROM entitlement_events WHERE tenant_id = $1 AND module_key = $2 ORDER BY created_at DESC',
    [tenantId, moduleKey],
  );
  return (r.rows as Array<{ action: string; seats: number | null; note: string | null; created_at: Date }>).map((x) => ({
    action: x.action, seats: x.seats, note: x.note, createdAt: x.created_at,
  }));
}
