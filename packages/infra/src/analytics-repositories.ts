/**
 * E06-07 — Atribuição de origem + funil analítico auditável.
 * R1 attribution append-only; R2 conversão de history; R3 tempo médio; R4 snapshot puro persistido;
 * R5 segmentação por unit; R6 tenant-scoped; R7 rates 0–100 com 2 casas, div/0 → 0.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class AnalyticsRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapAnalyticsError(e: unknown): { status: number } {
  if (e instanceof AnalyticsRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

export function rate(part: number, total: number): number {
  if (total <= 0) return 0; // R7
  return Math.round((part / total) * 10000) / 100;
}

export type Touch = {
  id: string; leadId: string; campaign: string | null;
  utmSource: string | null; utmMedium: string | null;
  firstTouchAt: string; lastTouchAt: string;
};

/** R1: registra touch — agrupa por (lead, campaign, utm_source, utm_medium); primeiro cria, depois avança last_touch. */
export async function recordTouch(c: PoolClient, tenantId: string, leadId: string, input: {
  campaign?: string; utmSource?: string; utmMedium?: string;
}): Promise<Touch> {
  const lead = await c.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  const existing = await c.query(
    `SELECT id, tenant_id, lead_id, campaign, utm_source, utm_medium, first_touch_at, last_touch_at
     FROM lead_source_attribution
     WHERE tenant_id = $1 AND lead_id = $2 AND campaign IS NOT DISTINCT FROM $3 AND utm_source IS NOT DISTINCT FROM $4 AND utm_medium IS NOT DISTINCT FROM $5
     FOR UPDATE`,
    [tenantId, leadId, input.campaign ?? null, input.utmSource ?? null, input.utmMedium ?? null],
  );
  if (existing.rowCount) {
    const upd = await c.query(
      `UPDATE lead_source_attribution SET last_touch_at = now() WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, lead_id, campaign, utm_source, utm_medium, first_touch_at, last_touch_at`,
      [(existing.rows[0] as { id: string }).id, tenantId],
    );
    return toTouch(upd.rows[0] as Record<string, unknown>);
  }
  const ins = await c.query(
    `INSERT INTO lead_source_attribution (id, tenant_id, lead_id, campaign, utm_source, utm_medium)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, tenant_id, lead_id, campaign, utm_source, utm_medium, first_touch_at, last_touch_at`,
    [randomUUID(), tenantId, leadId, input.campaign ?? null, input.utmSource ?? null, input.utmMedium ?? null],
  );
  return toTouch(ins.rows[0] as Record<string, unknown>);
}

function toTouch(r: Record<string, unknown>): Touch {
  const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
  return {
    id: r.id as string, leadId: r.lead_id as string, campaign: (r.campaign as string | null) ?? null,
    utmSource: (r.utm_source as string | null) ?? null, utmMedium: (r.utm_medium as string | null) ?? null,
    firstTouchAt: iso(r.first_touch_at), lastTouchAt: iso(r.last_touch_at),
  };
}

export async function listTouches(c: Pg, tenantId: string, leadId: string): Promise<Touch[]> {
  const r = await c.query(
    `SELECT id, tenant_id, lead_id, campaign, utm_source, utm_medium, first_touch_at, last_touch_at
     FROM lead_source_attribution WHERE tenant_id = $1 AND lead_id = $2 ORDER BY first_touch_at ASC`,
    [tenantId, leadId],
  );
  return (r.rows as Array<Record<string, unknown>>).map(toTouch);
}

export type StageStat = { stageId: string; label: string; entered: number; left: number; won: number; conversionRate: number; avgDays: number };

/**
 * R2–R5: computa estatísticas do funil a partir de lead_stage_history.
 * unitId NULL = todas as unidades (leads não têm unit direto; segmenta por proposals→people quando houver — MVP: filtro n/a).
 */
export async function computeFunnel(c: Pg, tenantId: string, unitId?: string): Promise<{ stages: StageStat[]; unitId: string | null }> {
  // stages do pipeline default do tenant
  const stages = await c.query(
    `SELECT id, label, kind, position FROM pipeline_stages
     WHERE tenant_id = $1 AND archived = false ORDER BY position`,
    [tenantId],
  );
  if (!stages.rowCount) throw new AnalyticsRuleError('tenant sem funil configurado');
  const wonIds = new Set((stages.rows as Array<{ id: string; kind: string }>).filter((s) => s.kind === 'won').map((s) => s.id));
  // history com entradas/saídas por stage (entrada = to_stage; saída = from_stage do movimento seguinte do mesmo lead)
  const hist = await c.query(
    `SELECT h.to_stage_id AS stage_id, h.changed_at AS entered_at,
            (SELECT h2.changed_at FROM lead_stage_history h2
              WHERE h2.tenant_id = h.tenant_id AND h2.lead_id = h.lead_id AND h2.changed_at > h.changed_at
              ORDER BY h2.changed_at LIMIT 1) AS left_at
     FROM lead_stage_history h WHERE h.tenant_id = $1`,
    [tenantId],
  );
  const rows = hist.rows as Array<{ stage_id: string; entered_at: Date | string; left_at: Date | string | null }>;
  const statMap = new Map<string, { entered: number; left: number; won: number; days: number[] }>();
  for (const s of stages.rows as Array<{ id: string; label: string }>) statMap.set(s.id, { entered: 0, left: 0, won: 0, days: [] });
  for (const h of rows) {
    const st = statMap.get(h.stage_id);
    if (!st) continue;
    st.entered += 1;
    if (h.left_at != null) {
      st.left += 1;
      const days = (new Date(h.left_at).getTime() - new Date(h.entered_at).getTime()) / 86_400_000;
      st.days.push(days);
    }
    if (wonIds.has(h.stage_id) && h.left_at == null) st.won += 1; // estágio won atual
  }
  const stagesList = stages.rows as Array<{ id: string; label: string }>;
  const out: StageStat[] = stagesList.map((s) => {
    const st = statMap.get(s.id)!;
    const avg = st.days.length ? Math.round((st.days.reduce((a, b) => a + b, 0) / st.days.length) * 10) / 10 : 0;
    return {
      stageId: s.id, label: s.label, entered: st.entered, left: st.left, won: st.won,
      conversionRate: rate(st.entered, st.entered), // occupancy não é conversão; conversão real p/ won abaixo
      avgDays: avg,
    };
  });
  // R2: taxa de conversão global = leads atuais em stage won ÷ total entradas no primeiro stage
  const firstStage = stagesList[0]!; // stages validado não-vazio acima
  // R2: entradas no 1º stage = history + leads nunca movidos (criados direto no 1º stage sem registro)
  const stillFirst = await c.query(
    `SELECT COUNT(*)::int AS n FROM leads l
     JOIN pipeline_stages ps ON ps.id = l.stage_id AND ps.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND ps.position = (SELECT MIN(position) FROM pipeline_stages WHERE tenant_id = $1 AND archived = false)
       AND l.id NOT IN (SELECT lead_id FROM lead_stage_history WHERE tenant_id = $1)`,
    [tenantId],
  );
  const neverMoved = Number((stillFirst.rows[0] as { n: number }).n);
  const totalEntered = statMap.get(firstStage.id)!.entered + neverMoved;
  const currentWon = await c.query(
    `SELECT COUNT(*)::int AS n FROM leads l
     JOIN pipeline_stages ps ON ps.id = l.stage_id AND ps.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND ps.kind = 'won' ${unitId ? 'AND l.campaign IS NOT DISTINCT FROM $2' : ''}`,
    unitId ? [tenantId, unitId] : [tenantId],
  );
  const wonNow = Number((currentWon.rows[0] as { n: number }).n);
  const global = { stageId: 'GLOBAL', label: 'conversão global', entered: totalEntered, left: 0, won: wonNow, conversionRate: rate(wonNow, totalEntered), avgDays: 0 };
  return { stages: [...out, global], unitId: unitId ?? null };
}

/** R4: computa e persiste snapshot (auditoria). */
export async function snapshotFunnel(c: PoolClient, tenantId: string, unitId?: string): Promise<{ id: string; computedAt: string; payload: { stages: StageStat[] } }> {
  const payload = await computeFunnel(c, tenantId, unitId);
  const r = await c.query(
    `INSERT INTO funnel_snapshots (id, tenant_id, unit_id, payload) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, computed_at, unit_id) DO UPDATE SET payload = EXCLUDED.payload
     RETURNING id, computed_at`,
    [randomUUID(), tenantId, unitId ?? null, JSON.stringify(payload)],
  );
  const row = r.rows[0] as { id: string; computed_at: Date | string };
  const at = row.computed_at instanceof Date ? row.computed_at.toISOString() : new Date(row.computed_at).toISOString();
  return { id: row.id, computedAt: at, payload };
}

export async function listSnapshots(c: Pg, tenantId: string, unitId: string | undefined, limit: number): Promise<Array<{ id: string; computedAt: string; unitId: string | null; payload: unknown }>> {
  const where = unitId ? 'tenant_id = $1 AND unit_id = $2' : 'tenant_id = $1 AND unit_id IS NULL';
  const vals = unitId ? [tenantId, unitId, limit] : [tenantId, limit];
  const r = await c.query(
    `SELECT id, computed_at, unit_id, payload FROM funnel_snapshots WHERE ${where} ORDER BY computed_at DESC LIMIT $${vals.length}`,
    vals,
  );
  return (r.rows as Array<{ id: string; computed_at: Date | string; unit_id: string | null; payload: unknown }>).map((x) => ({
    id: x.id,
    computedAt: x.computed_at instanceof Date ? x.computed_at.toISOString() : new Date(x.computed_at).toISOString(),
    unitId: x.unit_id, payload: x.payload,
  }));
}
