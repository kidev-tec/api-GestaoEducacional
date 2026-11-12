import type { Pool } from 'pg';

export interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> }

export class PlanRuleError extends Error { override name = 'PlanRuleError'; }
export class NotFoundError extends Error { override name = 'NotFoundError'; }
export class PlanVersionConflictError extends Error { override name = 'PlanVersionConflictError'; }

export type PlanType = 'STANDARD' | 'PILOT' | 'FRANCHISE';
export type BillingPeriod = 'MONTHLY' | 'ANNUAL';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface PlanVersionInput {
  key: string;
  name: string;
  planType: PlanType;
  billingPeriod: BillingPeriod;
  unitPriceCents: number;
  seatPriceCents?: number;
  minUnits?: number;
  maxUnits?: number;
  trialDays?: number;
  notes?: string;
  limits?: { key: string; value: number | null }[];
}

export interface PlanVersion {
  id: string; key: string; version: number; name: string; planType: PlanType;
  billingPeriod: BillingPeriod; unitPriceCents: number; seatPriceCents: number | null;
  minUnits: number; maxUnits: number | null; trialDays: number; published: boolean;
  effectiveFrom: string; effectiveTo: string | null; notes: string | null; createdAt: string;
  limits?: { key: string; value: number | null }[];
}

export interface QuoteLine { label: string; amount: number }
export interface Quote { planId: string; billingPeriod: BillingPeriod; lines: QuoteLine[]; totalCents: number }

const brl = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const num = (v: unknown): number => Number(v);
const nul = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toPlanVersion(r: Row): PlanVersion {
  return {
    id: str(r.id), key: str(r.key), version: num(r.version), name: str(r.name),
    planType: str(r.plan_type) as PlanType, billingPeriod: str(r.billing_period) as BillingPeriod,
    unitPriceCents: num(r.unit_price_cents), seatPriceCents: nul(r.seat_price_cents),
    minUnits: num(r.min_units), maxUnits: nul(r.max_units), trialDays: num(r.trial_days),
    published: Boolean(r.published),
    effectiveFrom: r.effective_from instanceof Date ? (r.effective_from as Date).toISOString().slice(0, 10) : str(r.effective_from),
    effectiveTo: r.effective_to instanceof Date ? (r.effective_to as Date).toISOString().slice(0, 10) : (r.effective_to === null || r.effective_to === undefined ? null : str(r.effective_to)),
    notes: r.notes === null || r.notes === undefined ? null : str(r.notes),
    createdAt: r.created_at instanceof Date ? (r.created_at as Date).toISOString() : str(r.created_at),
  };
}

/** Cria nova versão de plano (append-only). Nunca edita versão existente. */
export async function createPlanVersion(db: Queryable, input: PlanVersionInput): Promise<PlanVersion> {
  const minUnits = input.minUnits ?? 1;
  if (input.unitPriceCents < 0) throw new PlanRuleError('preço por unidade não pode ser negativo');
  if (input.seatPriceCents !== undefined && input.seatPriceCents < 0) throw new PlanRuleError('preço por assento não pode ser negativo');
  if (input.planType === 'PILOT' && !(input.trialDays && input.trialDays > 0)) throw new PlanRuleError('plano PILOT exige trialDays > 0');
  if (input.maxUnits !== undefined && minUnits > input.maxUnits) throw new PlanRuleError('minUnits não pode exceder maxUnits');

  const next = await db.query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM plan_versions WHERE key = $1', [input.key]);
  const version = num(next.rows[0]!.v);

  const ins = await db.query(
    `INSERT INTO plan_versions (key, version, name, plan_type, billing_period, unit_price_cents, seat_price_cents, min_units, max_units, trial_days, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [input.key, version, input.name, input.planType, input.billingPeriod, input.unitPriceCents,
     input.seatPriceCents ?? null, minUnits, input.maxUnits ?? null, input.trialDays ?? 0, input.notes ?? null],
  );
  if (ins.rows.length === 0) throw new PlanVersionConflictError(`versão ${version} já existe para ${input.key}`);
  const plan = toPlanVersion(ins.rows[0]!);

  for (const l of input.limits ?? []) {
    await db.query(
      'INSERT INTO plan_version_limits (plan_version_id, limit_key, limit_value) VALUES ($1, $2, $3)',
      [plan.id, l.key, l.value],
    );
  }
  return plan;
}

/** Publica versão: fecha vigência da versão publicada anterior da mesma key. */
export async function publishPlanVersion(db: Queryable, id: string): Promise<PlanVersion> {
  await db.query(
    `UPDATE plan_versions SET effective_to = CURRENT_DATE
     WHERE key = (SELECT key FROM plan_versions WHERE id = $1) AND published = true AND id <> $1 AND effective_to IS NULL`,
    [id],
  );
  const r = await db.query('UPDATE plan_versions SET published = true, effective_to = NULL WHERE id = $1 RETURNING *', [id]);
  if (r.rows.length === 0) throw new NotFoundError('versão de plano não encontrada');
  return toPlanVersion(r.rows[0]!);
}

export async function listPlanVersions(db: Queryable, opts: { includeUnpublished: boolean }): Promise<PlanVersion[]> {
  const where = opts.includeUnpublished ? '' : 'WHERE published = true';
  const r = await db.query(`SELECT * FROM plan_versions ${where} ORDER BY key, version DESC`, []);
  return r.rows.map(toPlanVersion);
}

export async function getPlanVersion(db: Queryable, id: string): Promise<PlanVersion> {
  const r = await db.query(
    `SELECT pv.*, lvl.limit_key, lvl.limit_value
     FROM plan_versions pv LEFT JOIN plan_version_limits lvl ON lvl.plan_version_id = pv.id
     WHERE pv.id = $1`,
    [id],
  );
  if (r.rows.length === 0) throw new NotFoundError('versão de plano não encontrada');
  const limits = r.rows.filter((x) => x.limit_key !== null && x.limit_key !== undefined)
    .map((x) => ({ key: str(x.limit_key), value: nul(x.limit_value) }));
  return { ...toPlanVersion(r.rows[0]!), limits };
}

/** Simulador: breakdown itemizado, zero regra oculta. */
export async function quotePlan(db: Queryable, input: {
  planId: string; units: number; seats: number; priceOverrideCents?: number;
}): Promise<Quote> {
  if (input.seats < 0) throw new PlanRuleError('assentos não podem ser negativos');
  const r = await db.query('SELECT * FROM plan_versions WHERE id = $1', [input.planId]);
  if (r.rows.length === 0) throw new NotFoundError('versão de plano não encontrada');
  const p = toPlanVersion(r.rows[0]!);
  if (input.units < p.minUnits) throw new PlanRuleError(`mínimo de ${p.minUnits} unidade(s)`);
  if (p.maxUnits !== null && input.units > p.maxUnits) throw new PlanRuleError(`máximo de ${p.maxUnits} unidade(s)`);

  const lines: QuoteLine[] = [];
  if (p.planType === 'PILOT') {
    lines.push({ label: `Trial ${p.trialDays} dias (grátis)`, amount: 0 });
    return { planId: p.id, billingPeriod: p.billingPeriod, lines, totalCents: 0 };
  }

  const unit = input.priceOverrideCents !== undefined && p.planType === 'FRANCHISE'
    ? input.priceOverrideCents : p.unitPriceCents;
  const unitLabel = input.priceOverrideCents !== undefined && p.planType === 'FRANCHISE'
    ? `${input.units} × ${brl(unit)} (preço negociado)` : `${input.units} × ${brl(unit)}`;
  const months = p.billingPeriod === 'ANNUAL' ? 12 : 1;
  const monthMult = p.billingPeriod === 'ANNUAL' ? 12 : 1;
  lines.push({ label: `Unidades (${unitLabel}${months > 1 ? ' × 12' : ''})`, amount: input.units * unit * monthMult });
  if (p.billingPeriod === 'ANNUAL') lines.push({ label: 'Desconto anual (2 meses)', amount: -2 * unit * input.units });

  if (input.seats > 0 && p.seatPriceCents !== null && p.seatPriceCents !== undefined && p.seatPriceCents > 0) {
    lines.push({ label: `Assentos (${input.seats} × ${brl(p.seatPriceCents)}${months > 1 ? ' × 12' : ''})`, amount: input.seats * p.seatPriceCents * monthMult });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { planId: p.id, billingPeriod: p.billingPeriod, lines, totalCents: total };
}

export interface Subscription {
  id: string; tenantId: string; planVersionId: string; status: SubscriptionStatus;
  startedAt: string; currentPeriodEnd: string | null; priceOverrideCents: number | null;
  createdAt: string; updatedAt: string;
}

const STATUSES: SubscriptionStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED'];
function toSubscription(r: Row): Subscription {
  return {
    id: str(r.id), tenantId: str(r.tenant_id), planVersionId: str(r.plan_version_id),
    status: str(r.status) as SubscriptionStatus,
    startedAt: r.started_at instanceof Date ? (r.started_at as Date).toISOString().slice(0, 10) : str(r.started_at),
    currentPeriodEnd: r.current_period_end === null || r.current_period_end === undefined ? null
      : (r.current_period_end instanceof Date ? (r.current_period_end as Date).toISOString().slice(0, 10) : str(r.current_period_end)),
    priceOverrideCents: nul(r.price_override_cents),
    createdAt: r.created_at instanceof Date ? (r.created_at as Date).toISOString() : str(r.created_at),
    updatedAt: r.updated_at instanceof Date ? (r.updated_at as Date).toISOString() : str(r.updated_at),
  };
}

export async function getSubscription(db: Queryable, tenantId: string): Promise<Subscription | null> {
  const r = await db.query('SELECT * FROM tenant_subscriptions WHERE tenant_id = $1', [tenantId]);
  return r.rows.length === 0 ? null : toSubscription(r.rows[0]!);
}

export async function upsertSubscription(db: Queryable, input: {
  tenantId: string; planVersionId: string; status: SubscriptionStatus; currentPeriodEnd?: string; priceOverrideCents?: number;
}): Promise<Subscription> {
  if (!STATUSES.includes(input.status)) throw new PlanRuleError(`status inválido: ${input.status}`);
  const r = await db.query(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_version_id, status, current_period_end, price_override_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET plan_version_id = EXCLUDED.plan_version_id, status = EXCLUDED.status,
       current_period_end = EXCLUDED.current_period_end, price_override_cents = EXCLUDED.price_override_cents, updated_at = now()
     RETURNING *`,
    [input.tenantId, input.planVersionId, input.status, input.currentPeriodEnd ?? null, input.priceOverrideCents ?? null],
  );
  return toSubscription(r.rows[0]!);
}
