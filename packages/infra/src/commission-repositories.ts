/**
 * E06-06 — Comissões versionadas + metas comerciais.
 * R1 versões imutáveis; R2 crédito por settle conciliado; R3 elegibilidade vigente;
 * R4 half-up PERCENT / FLAT cap; R5 reversal idempotente; R6 confirm owner/admin;
 * R7 metas progresso; R8 tenant-scoped.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class CommissionRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapCommissionError(e: unknown): { status: number } {
  if (e instanceof CommissionRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

export type CommissionRule = {
  id: string; tenantId: string; name: string; version: number;
  kind: 'PERCENT' | 'FLAT'; value: number; targetUserId: string | null;
  minTotalCents: number | null; validFrom: string; validTo: string | null;
};

type RuleRow = {
  id: string; tenant_id: string; name: string; version: number; kind: 'PERCENT' | 'FLAT';
  value: string | number; target_user_id: string | null; min_total_cents: number | null;
  valid_from: Date | string; valid_to: Date | string | null;
};

function toRule(r: RuleRow): CommissionRule {
  const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, version: r.version, kind: r.kind,
    value: Number(r.value), targetUserId: r.target_user_id, minTotalCents: r.min_total_cents,
    validFrom: iso(r.valid_from) as string, validTo: iso(r.valid_to),
  };
}

/** R4: cálculo determinístico. PERCENT half-up; FLAT cap no base. */
export function computeCommission(baseCents: number, kind: 'PERCENT' | 'FLAT', value: number): number {
  if (baseCents <= 0) throw new CommissionRuleError('base must be positive');
  if (kind === 'FLAT') return Math.min(value, baseCents);
  return Math.round(baseCents * (value / 100)); // half-up nativo do Math.round p/ positivos
}

export async function createCommissionRule(c: Pg, tenantId: string, input: {
  name: string; kind: 'PERCENT' | 'FLAT'; value: number; targetUserId?: string;
  minTotalCents?: number; validFrom?: string;
}, actor: string): Promise<CommissionRule> {
  if (!input.name?.trim()) throw new CommissionRuleError('name required');
  if (input.kind !== 'PERCENT' && input.kind !== 'FLAT') throw new CommissionRuleError('kind must be PERCENT or FLAT');
  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) throw new CommissionRuleError('value must be a finite number');
  if (input.kind === 'PERCENT' && (input.value <= 0 || input.value > 50)) throw new CommissionRuleError('PERCENT value must be 0–50');
  if (input.kind === 'FLAT' && input.value <= 0) throw new CommissionRuleError('FLAT value must be positive');
  // R1: fecha versão anterior aberta com mesmo nome
  const last = await c.query(
    'SELECT version FROM commission_rules WHERE tenant_id = $1 AND name = $2 ORDER BY version DESC LIMIT 1',
    [tenantId, input.name],
  );
  const version = last.rowCount ? (last.rows[0] as { version: number }).version + 1 : 1;
  if (version > 1) {
    await c.query(
      'UPDATE commission_rules SET valid_to = CURRENT_DATE - 1 WHERE tenant_id = $1 AND name = $2 AND valid_to IS NULL',
      [tenantId, input.name],
    );
  }
  const r = await c.query(
    `INSERT INTO commission_rules (id, tenant_id, name, version, kind, value, target_user_id, min_total_cents, valid_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::date, CURRENT_DATE), $10)
     RETURNING id, tenant_id, name, version, kind, value, target_user_id, min_total_cents, valid_from, valid_to`,
    [randomUUID(), tenantId, input.name, version, input.kind, input.value, input.targetUserId ?? null,
      input.minTotalCents ?? null, input.validFrom ?? null, actor],
  );
  return toRule(r.rows[0] as RuleRow);
}

export async function listCommissionRules(c: Pg, tenantId: string, activeOnly: boolean): Promise<CommissionRule[]> {
  const where = activeOnly
    ? 'tenant_id = $1 AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)'
    : 'tenant_id = $1';
  const r = await c.query(
    `SELECT id, tenant_id, name, version, kind, value, target_user_id, min_total_cents, valid_from, valid_to
     FROM commission_rules WHERE ${where} ORDER BY name, version DESC`,
    [tenantId],
  );
  return (r.rows as RuleRow[]).map(toRule);
}

export type Credit = {
  id: string; tenantId: string; ruleId: string; ruleVersion: number; enrollmentId: string;
  userId: string; baseCents: number; amountCents: number; status: 'PENDING' | 'CONFIRMED' | 'REVERSED' | 'CANCELED';
  sourceEvent: string; sourceId: string;
};

type CreditRow = Record<string, unknown> & {
  id: string; tenant_id: string; rule_id: string; rule_version: number; enrollment_id: string;
  user_id: string; base_cents: number; amount_cents: number; status: Credit['status'];
  source_event: string; source_id: string;
};

function toCredit(r: CreditRow): Credit {
  return {
    id: r.id, tenantId: r.tenant_id, ruleId: r.rule_id, ruleVersion: r.rule_version,
    enrollmentId: r.enrollment_id, userId: r.user_id, baseCents: r.base_cents,
    amountCents: r.amount_cents, status: r.status, sourceEvent: r.source_event, sourceId: r.source_id,
  };
}

/**
 * R2–R5: conciliação idempotente. Dado enrollment + evento financeiro:
 * - encontra regras vigentes elegíveis → cria crédito PENDING (skip se já existe p/ a versão);
 * - se matrícula cancelada/reversal → REVERSED.
 */
export async function reconcileCommission(c: PoolClient, tenantId: string, input: {
  enrollmentId: string; userId: string; baseCents: number; sourceEvent: string; sourceId: string;
}): Promise<{ created: Credit[]; reversed: Credit[] }> {
  if (input.baseCents <= 0) throw new CommissionRuleError('base must be positive');
  const enr = await c.query('SELECT id FROM enrollments WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [input.enrollmentId, tenantId]);
  if (!enr.rowCount) throw new NotFoundError('matrícula não encontrada');

  const rules = await c.query(
    `SELECT id, tenant_id, name, version, kind, value, target_user_id, min_total_cents, valid_from, valid_to
     FROM commission_rules
     WHERE tenant_id = $1 AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
       AND (target_user_id IS NULL OR target_user_id = $2)`,
    [tenantId, input.userId],
  );
  const created: Credit[] = [];
  for (const raw of rules.rows as RuleRow[]) {
    const rule = toRule(raw);
    if (rule.minTotalCents != null && input.baseCents < rule.minTotalCents) continue; // R3
    const amount = computeCommission(input.baseCents, rule.kind, rule.value);
    const r = await c.query(
      `INSERT INTO commission_credits (id, tenant_id, rule_id, rule_version, enrollment_id, user_id, base_cents, amount_cents, status, source_event, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10)
       ON CONFLICT (tenant_id, enrollment_id, rule_version, user_id) DO NOTHING
       RETURNING id, tenant_id, rule_id, rule_version, enrollment_id, user_id, base_cents, amount_cents, status, source_event, source_id`,
      [randomUUID(), tenantId, rule.id, rule.version, input.enrollmentId, input.userId, input.baseCents, amount, input.sourceEvent, input.sourceId],
    );
    if (r.rowCount) created.push(toCredit(r.rows[0] as CreditRow));
  }
  // R5: se existe evento de reversão para esta matrícula, reverte créditos não-revertidos
  let reversed: Credit[] = [];
  if (input.sourceEvent === 'ledger.reversal') {
    const rev = await c.query(
      `UPDATE commission_credits SET status = 'REVERSED', reversed_at = now()
       WHERE tenant_id = $1 AND enrollment_id = $2 AND status IN ('PENDING','CONFIRMED')
       RETURNING id, tenant_id, rule_id, rule_version, enrollment_id, user_id, base_cents, amount_cents, status, source_event, source_id`,
      [tenantId, input.enrollmentId],
    );
    reversed = (rev.rows as CreditRow[]).map(toCredit);
  }
  return { created, reversed };
}

export async function confirmCredit(c: PoolClient, tenantId: string, creditId: string, role: string | undefined): Promise<Credit> {
  if (role !== 'owner' && role !== 'admin') throw new CommissionRuleError('confirmação exige owner/admin'); // R6
  const r = await c.query(
    `UPDATE commission_credits SET status = 'CONFIRMED', confirmed_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
     RETURNING id, tenant_id, rule_id, rule_version, enrollment_id, user_id, base_cents, amount_cents, status, source_event, source_id`,
    [creditId, tenantId],
  );
  if (!r.rowCount) throw new NotFoundError('crédito não encontrado ou não está PENDING');
  return toCredit(r.rows[0] as CreditRow);
}

export async function listCredits(c: Pg, tenantId: string, filter: { userId?: string; status?: string }): Promise<Credit[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.userId) { vals.push(filter.userId); conds.push(`user_id = $${vals.length}`); }
  if (filter.status) { vals.push(filter.status); conds.push(`status = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, rule_id, rule_version, enrollment_id, user_id, base_cents, amount_cents, status, source_event, source_id
     FROM commission_credits WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
    vals,
  );
  return (r.rows as CreditRow[]).map(toCredit);
}

export async function upsertTarget(c: Pg, tenantId: string, input: { userId: string; period: string; amountCents: number }): Promise<{ userId: string; period: string; amountCents: number }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new CommissionRuleError('period must be YYYY-MM (month 01–12)');
  if (input.amountCents <= 0) throw new CommissionRuleError('amount must be positive');
  await c.query(
    `INSERT INTO sales_targets (id, tenant_id, user_id, period, amount_cents) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, user_id, period) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`,
    [randomUUID(), tenantId, input.userId, input.period, input.amountCents],
  );
  return { userId: input.userId, period: input.period, amountCents: input.amountCents };
}

/** R7: progresso por vendedor no período (CONFIRMED apenas). */
export async function targetProgress(c: Pg, tenantId: string, period: string): Promise<Array<{ userId: string; targetCents: number; confirmedCents: number; progressPct: number }>> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new CommissionRuleError('period must be YYYY-MM (month 01–12)');
  const targets = await c.query(
    'SELECT user_id, amount_cents FROM sales_targets WHERE tenant_id = $1 AND period = $2 ORDER BY user_id',
    [tenantId, period],
  );
  const out: Array<{ userId: string; targetCents: number; confirmedCents: number; progressPct: number }> = [];
  for (const t of targets.rows as Array<{ user_id: string; amount_cents: number }>) {
    const sum = await c.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM commission_credits
       WHERE tenant_id = $1 AND user_id = $2 AND status = 'CONFIRMED'
         AND to_char(confirmed_at, 'YYYY-MM') = $3`,
      [tenantId, t.user_id, period],
    );
    const confirmed = Number((sum.rows[0] as { total: string | number }).total);
    out.push({
      userId: t.user_id, targetCents: t.amount_cents, confirmedCents: confirmed,
      progressPct: Math.round((confirmed / t.amount_cents) * 10000) / 100, // target > 0 garantido por CHECK
    });
  }
  return out;
}
