import { randomUUID } from 'node:crypto';

/** Erros de domínio do E13-04. */
export class TrialRuleError extends Error {
  override name = 'TrialRuleError';
  constructor(message: string) { super(message); }
}
export class TransitionRuleError extends Error {
  override name = 'TransitionRuleError';
  constructor(message: string) { super(message); }
}
export class SubscriptionNotFoundError extends Error {
  override name = 'SubscriptionNotFoundError';
  constructor(message: string) { super(message); }
}
export class NotFoundError extends Error {
  override name = 'NotFoundError';
  constructor(message: string) { super(message); }
}

type Queryable = { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

export type PlanVersionRow = {
  id: string; key: string; version: number; name: string; plan_type: string;
  billing_period: string; unit_price_cents: number; seat_price_cents: number | null;
  min_units: number; max_units: number | null; trial_days: number; published: boolean;
};

export type SubscriptionRow = {
  id: string; tenantId: string; planVersionId: string; status: string;
  startedAt: string; currentPeriodEnd: string | null; priceOverrideCents: number | null;
};

export type Transition = {
  id: string; tenantId: string; fromPlanVersionId: string | null; toPlanVersionId: string;
  mode: string; actorUserId: string | null; notes: string | null; transitionedAt: string;
};

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function loadPlan(c: Queryable, planVersionId: string): Promise<PlanVersionRow> {
  const r = await c.query('SELECT * FROM plan_versions WHERE id = $1', [planVersionId]);
  if (!r.rowCount) throw new NotFoundError('plano não encontrado');
  return r.rows[0] as PlanVersionRow;
}

/** Cria tenant + assinatura TRIAL em plano PILOT publicado. */
export async function createTrial(c: Queryable, input: { name: string; planVersionId: string; actorUserId?: string }): Promise<{ tenant: { id: string; slug: string }; subscription: SubscriptionRow }> {
  const plan = await loadPlan(c, input.planVersionId);
  if (plan.plan_type !== 'PILOT') throw new TrialRuleError('trial exige plano PILOT');
  if (!plan.published) throw new TrialRuleError('plano não publicado');

  let slug = slugify(input.name);
  const exists = await c.query('SELECT * FROM tenants WHERE slug = $1', [slug]);
  if (exists.rowCount) throw new TrialRuleError(`slug já existe: ${slug}`);

  const tenantId = `t_${randomUUID().slice(0, 12)}`;
  await c.query('INSERT INTO tenants (id, slug) VALUES ($1, $2)', [tenantId, slug]);
  const days = plan.trial_days > 0 ? plan.trial_days : 14;
  const ends = iso(new Date(Date.now() + days * DAY));
  const sub = await c.query(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_version_id, status, current_period_end)
     VALUES ($1,$2,'TRIAL',$3) RETURNING *`,
    [tenantId, plan.id, ends],
  );
  const row = sub.rows[0] as any;
  await c.query(
    `INSERT INTO subscription_transitions (tenant_id, from_plan_version_id, to_plan_version_id, mode, actor_user_id)
     VALUES ($1, NULL, $2, 'TRIAL', $3)`,
    [tenantId, plan.id, input.actorUserId ?? null],
  );
  return { tenant: { id: tenantId, slug }, subscription: toSub(row) };
}

async function activeUnitCount(_c: Queryable, _tenantId: string): Promise<number> {
  // ponytail: contagem real de matrículas ativas entra no E13-05 (billing); por ora 1 (mínimo universal)
  return 1;
}

/** Troca de plano nunca destrutiva; downgrade = grace até period_end; cancel revoga já. */
export async function transitionSubscription(c: Queryable, tenantId: string, input: {
  planVersionId: string; mode: 'TRIAL' | 'UPGRADE' | 'DOWNGRADE' | 'CANCEL'; actorUserId?: string; notes?: string;
}): Promise<{ subscription: SubscriptionRow; transition: Transition }> {
  const MODES = ['TRIAL', 'UPGRADE', 'DOWNGRADE', 'CANCEL'];
  if (!MODES.includes(input.mode)) throw new TransitionRuleError(`mode inválido: ${String(input.mode)}`);
  const plan = await loadPlan(c, input.planVersionId);
  const cur = await c.query('SELECT * FROM tenant_subscriptions WHERE tenant_id = $1', [tenantId]);
  if (!cur.rowCount) throw new SubscriptionNotFoundError('assinatura não encontrada para o tenant');
  const current = cur.rows[0] as any;

  if (input.mode === 'DOWNGRADE' && plan.min_units > 1) {
    const units = await activeUnitCount(c, tenantId);
    if (units < plan.min_units) throw new TransitionRuleError(`plano exige >= ${plan.min_units} unidades; tenant tem ${units}`);
  }

  let status = 'ACTIVE';
  let ends: string;
  if (input.mode === 'CANCEL') {
    status = 'CANCELED';
    ends = iso(new Date());
  } else if (input.mode === 'TRIAL') {
    status = 'TRIAL';
    const days = plan.trial_days > 0 ? plan.trial_days : 14;
    ends = iso(new Date(Date.now() + days * DAY));
  } else {
    const periodDays = plan.billing_period === 'ANNUAL' ? 365 : 30;
    ends = iso(new Date(Date.now() + periodDays * DAY));
  }

  const upd = await c.query(
    `UPDATE tenant_subscriptions SET plan_version_id = $2, status = $3, current_period_end = $4, updated_at = now()
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId, plan.id, status, ends],
  );

  // Entitlements: UPGRADE/TRIAL concede os do plano novo; DOWNGRADE preserva (grace); CANCEL revoga já.
  if (input.mode === 'CANCEL') {
    await c.query('UPDATE tenant_entitlements SET active = false, updated_at = now() WHERE tenant_id = $1 AND active = true', [tenantId]);
  } else if (input.mode !== 'DOWNGRADE') {
    const limits = await c.query('SELECT * FROM plan_version_limits WHERE plan_version_id = $1', [plan.id]);
    for (const lim of limits.rows as any[]) {
      const has = await c.query('SELECT 1 FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2', [tenantId, lim.limit_key]);
      if (has.rowCount) {
        await c.query('UPDATE tenant_entitlements SET active = true, updated_at = now() WHERE tenant_id = $1 AND module_key = $2', [tenantId, lim.limit_key]);
      } else {
        await c.query('INSERT INTO tenant_entitlements (id, tenant_id, module_key) VALUES ($1,$2,$3)', [randomUUID(), tenantId, lim.limit_key]);
      }
    }
  }

  const tr = await c.query(
    `INSERT INTO subscription_transitions (tenant_id, from_plan_version_id, to_plan_version_id, mode, actor_user_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenantId, current.plan_version_id, plan.id, input.mode, input.actorUserId ?? null, input.notes ?? null],
  );
  return { subscription: toSub(upd.rows[0] as any), transition: toTr(tr.rows[0] as any) };
}

export async function listTransitions(c: Queryable, tenantId: string): Promise<Transition[]> {
  const r = await c.query('SELECT * FROM subscription_transitions WHERE tenant_id = $1 ORDER BY transitioned_at DESC', [tenantId]);
  return (r.rows as any[]).map(toTr);
}

export async function exportTenantData(c: Queryable, tenantId: string): Promise<{
  people: unknown[]; enrollments: unknown[]; subscriptions: unknown[]; transitions: unknown[];
}> {
  const [people, enrollments, subs, trans] = await Promise.all([
    c.query('SELECT * FROM people WHERE tenant_id = $1', [tenantId]),
    c.query('SELECT * FROM enrollments WHERE tenant_id = $1', [tenantId]),
    c.query('SELECT * FROM tenant_subscriptions WHERE tenant_id = $1', [tenantId]),
    c.query('SELECT * FROM subscription_transitions WHERE tenant_id = $1', [tenantId]),
  ]);
  return { people: people.rows, enrollments: enrollments.rows, subscriptions: subs.rows, transitions: trans.rows };
}

function day(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function toSub(r: any): SubscriptionRow {
  return {
    id: r.id, tenantId: r.tenant_id, planVersionId: r.plan_version_id, status: r.status,
    startedAt: day(r.started_at),
    currentPeriodEnd: r.current_period_end == null ? null : day(r.current_period_end),
    priceOverrideCents: r.price_override_cents ?? null,
  };
}
function toTr(r: any): Transition {
  return {
    id: r.id, tenantId: r.tenant_id, fromPlanVersionId: r.from_plan_version_id ?? null,
    toPlanVersionId: r.to_plan_version_id, mode: r.mode, actorUserId: r.actor_user_id ?? null,
    notes: r.notes ?? null, transitionedAt: String(r.transitioned_at),
  };
}
