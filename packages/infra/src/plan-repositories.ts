/**
 * E13-A — Planos comerciais + entitlements persistidos + grandfathering.
 * Downgrade NÃO remove módulos já utilizados (union de todos os planos do tenant).
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from './people-repositories.js';

export const UNLIMITED = -1;

/** Qualquer coisa com query() — Pool, PoolClient ou fake de teste. */
export interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> }

export interface PlanRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly priceCents: number;
  readonly active: boolean;
  readonly modules: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
}

export class PlanRuleError extends Error {}

export async function createCommercialPlan(
  client: Queryable,
  params: { code: string; name: string; priceCents: number; modules?: readonly string[]; limits?: Readonly<Record<string, number>> },
): Promise<PlanRow> {
  if (!/^[a-z0-9-]{2,32}$/.test(params.code)) throw new PlanRuleError('code must be slug 2..32 [a-z0-9-]');
  if (!Number.isInteger(params.priceCents) || params.priceCents < 0) throw new PlanRuleError('price must be integer cents >= 0');
  for (const [k, v] of Object.entries(params.limits ?? {})) {
    if (!/^[a-z_]{2,40}$/.test(k) || !Number.isInteger(v) || v < -1) throw new PlanRuleError(`bad limit ${k}`);
  }
  const id = randomUUID();
  const res = await client.query(
    'INSERT INTO plans (id, code, name, price_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING RETURNING id, code, name, price_cents, active',
    [id, params.code, params.name, params.priceCents],
  );
  if (!res.rowCount) throw new ConflictError(`plan code ${params.code} already exists`);
  for (const m of params.modules ?? []) {
    await client.query('INSERT INTO plan_modules (plan_id, module) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, m]);
  }
  for (const [k, v] of Object.entries(params.limits ?? {})) {
    await client.query('INSERT INTO plan_limits (plan_id, limit_key, limit_value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, k, v]);
  }
  return {
    id, code: params.code, name: params.name, priceCents: params.priceCents, active: true,
    modules: [...(params.modules ?? [])], limits: { ...(params.limits ?? {}) },
  };
}

export async function listCommercialPlans(pool: Queryable): Promise<PlanRow[]> {
  const plans = await pool.query('SELECT id, code, name, price_cents, active FROM plans ORDER BY code');
  if (!plans.rowCount) return [];
  const mods = await pool.query('SELECT plan_id, module FROM plan_modules');
  const lims = await pool.query('SELECT plan_id, limit_key, limit_value FROM plan_limits');
  const modMap = new Map<string, string[]>();
  for (const r of mods.rows as { plan_id: string; module: string }[]) {
    (modMap.get(r.plan_id) ?? modMap.set(r.plan_id, []).get(r.plan_id)!).push(r.module);
  }
  const limMap = new Map<string, Record<string, number>>();
  for (const r of lims.rows as { plan_id: string; limit_key: string; limit_value: number }[]) {
    (limMap.get(r.plan_id) ?? limMap.set(r.plan_id, {}).get(r.plan_id)!)[r.limit_key] = Number(r.limit_value);
  }
  return (plans.rows as { id: string; code: string; name: string; price_cents: number; active: boolean }[]).map((p) => ({
    id: p.id, code: p.code, name: p.name, priceCents: Number(p.price_cents), active: p.active,
    modules: modMap.get(p.id) ?? [], limits: limMap.get(p.id) ?? {},
  }));
}

/** Assign: encerra vigência anterior e inicia nova — atômico na tx do caller. */
export async function assignPlan(client: Queryable, tenantId: string, planId: string, now = new Date().toISOString()): Promise<void> {
  const plan = await client.query('SELECT id FROM plans WHERE id = $1 AND active', [planId]);
  if (!plan.rowCount) throw new NotFoundError('plan');
  await client.query('UPDATE tenant_plans SET ended_at = $2 WHERE tenant_id = $1 AND ended_at IS NULL', [tenantId, now]);
  await client.query('INSERT INTO tenant_plans (tenant_id, plan_id, started_at) VALUES ($1,$2,$3)', [tenantId, planId, now]);
}

/** Plano vigente (ended_at IS NULL) ou null. */
export async function currentPlan(pool: Pool, tenantId: string): Promise<PlanRow | null> {
  const res = await pool.query(
    `SELECT p.id, p.code, p.name, p.price_cents, p.active
     FROM tenant_plans tp JOIN plans p ON p.id = tp.plan_id
     WHERE tp.tenant_id = $1 AND tp.ended_at IS NULL LIMIT 1`,
    [tenantId],
  );
  if (!res.rowCount) return null;
  const row = res.rows[0] as { id: string; code: string; name: string; price_cents: number; active: boolean };
  const mods = await pool.query('SELECT module FROM plan_modules WHERE plan_id = $1', [row.id]);
  const lims = await pool.query('SELECT limit_key, limit_value FROM plan_limits WHERE plan_id = $1', [row.id]);
  const limits: Record<string, number> = {};
  for (const r of lims.rows as { limit_key: string; limit_value: number }[]) limits[r.limit_key] = Number(r.limit_value);
  return {
    id: row.id, code: row.code, name: row.name, priceCents: Number(row.price_cents), active: row.active,
    modules: (mods.rows as { module: string }[]).map((r) => r.module), limits,
  };
}

/**
 * Grandfathering: módulos = union(módulos de TODOS os planos já assignados).
 * Downgrade nunca desliga o que o tenant já teve.
 */
export async function entitledModules(pool: Pool, tenantId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT DISTINCT pm.module FROM tenant_plans tp
     JOIN plan_modules pm ON pm.plan_id = tp.plan_id
     WHERE tp.tenant_id = $1`,
    [tenantId],
  );
  return [...new Set((res.rows as { module: string }[]).map((r) => r.module))].sort();
}

/** Limite do plano vigente; sem plano → UNLIMITED (trial/dev: liberado até assign de plano pago). */
export async function planLimit(pool: Pool, tenantId: string, key: string): Promise<number> {
  const plan = await currentPlan(pool, tenantId);
  if (!plan) return UNLIMITED;
  const v = plan.limits[key];
  return v === undefined ? UNLIMITED : v; // sem limite definido = ilimitado p/ essa key
}

export async function countStudents(pool: Pool, tenantId: string): Promise<number> {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM people WHERE tenant_id = $1 AND kind = 'STUDENT'", [tenantId]);
  return (res.rows[0] as { n: number }).n;
}
