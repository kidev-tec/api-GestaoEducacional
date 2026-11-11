/**
 * E06-A — CRM v1: leads + funil (SPEC-E06-A-crm-v1 FROZEN).
 * Dedup por (tenant,email); funil fixo com guardas LGPD (WON exige consent).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './plan-repositories.js';

export const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SOURCES = ['website', 'referral', 'social', 'event', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export class LeadRuleError extends Error {}
export { ConflictError, NotFoundError } from './people-repositories.js';
import { ConflictError, NotFoundError } from './people-repositories.js';

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: LeadSource;
  campaign: string | null;
  consent: boolean;
  stage: LeadStage;
  lostReason: string | null;
  createdAt: string;
}

interface DbLead {
  id: string; name: string; email: string; phone: string | null;
  source: LeadSource; campaign: string | null; consent: boolean;
  stage: LeadStage; lost_reason: string | null; created_at: string;
}
const toRow = (r: DbLead): LeadRow => ({
  id: r.id, name: r.name, email: r.email, phone: r.phone, source: r.source,
  campaign: r.campaign, consent: r.consent, stage: r.stage,
  lostReason: r.lost_reason, createdAt: r.created_at,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADJACENT: Record<LeadStage, LeadStage[]> = {
  NEW: ['CONTACTED'],
  CONTACTED: ['QUALIFIED'],
  QUALIFIED: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};

export interface CreateLeadInput {
  name: string; email: string; source: LeadSource;
  phone?: string; campaign?: string; consent?: boolean;
}

export async function createLead(client: Queryable, tenantId: string, input: CreateLeadInput): Promise<LeadRow> {
  if (!input.name?.trim()) throw new LeadRuleError('name is required');
  if (!EMAIL_RE.test(input.email ?? '')) throw new LeadRuleError('valid email is required');
  if (!LEAD_SOURCES.includes(input.source)) throw new LeadRuleError('invalid lead source');
  if (input.phone !== undefined && input.phone !== null && input.phone.length > 20) throw new LeadRuleError('phone too long');
  if (input.campaign !== undefined && input.campaign !== null && input.campaign.length > 120) throw new LeadRuleError('campaign too long');
  const id = randomUUID();
  const res = await client.query(
    `INSERT INTO leads (id, tenant_id, name, email, phone, source, campaign, consent, stage_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       (SELECT id FROM pipeline_stages WHERE tenant_id = $2 AND kind = 'open' AND archived = false ORDER BY position LIMIT 1))
     ON CONFLICT (tenant_id, email) DO NOTHING
     RETURNING id, name, email, phone, source, campaign, consent, stage, lost_reason, created_at`,
    [id, tenantId, input.name.trim(), input.email, input.phone ?? null, input.source, input.campaign ?? null, input.consent ?? false],
  );
  if (!res.rowCount) throw new ConflictError(`lead with email ${input.email} already exists`);
  return toRow(res.rows[0] as unknown as DbLead);
}

export interface ListLeadsFilter { stage?: LeadStage; source?: LeadSource; limit?: number; offset?: number }

export async function listLeads(client: Queryable, tenantId: string, filter: ListLeadsFilter = {}): Promise<{ leads: LeadRow[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);
  const where: string[] = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.stage) { values.push(filter.stage); where.push(`stage = $${values.length}`); }
  if (filter.source) { values.push(filter.source); where.push(`source = $${values.length}`); }
  const rows = await client.query(
    `SELECT id, name, email, phone, source, campaign, consent, stage, lost_reason, created_at
     FROM leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const count = await client.query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE ${where.join(' AND ')}`,
    values,
  );
  return { leads: (rows.rows as unknown as DbLead[]).map(toRow), total: Number((count.rows[0] as { n: number }).n) };
}

const STAGE_TRANSITIONS = 'only adjacent stages or WON/LOST from any stage';

export async function moveLeadStage(
  client: Queryable, tenantId: string, leadId: string, to: LeadStage, lostReason?: string, userId?: string,
): Promise<LeadRow> {
  if (!LEAD_STAGES.includes(to)) throw new LeadRuleError('invalid target stage');
  const cur = await client.query(
    'SELECT id, stage, consent FROM leads WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [leadId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError("lead");
  const lead = cur.rows[0] as { stage: LeadStage; consent: boolean };
  const from = lead.stage;
  if (from === 'WON' || from === 'LOST') throw new LeadRuleError('lead is already closed');
  const adjacent = ADJACENT[from];
  if (to !== 'WON' && to !== 'LOST' && !adjacent.includes(to)) {
    throw new LeadRuleError(STAGE_TRANSITIONS);
  }
  if (to === 'LOST' && (!lostReason || lostReason.trim().length < 3)) {
    throw new LeadRuleError('lost_reason is required when losing a lead');
  }
  if (to === 'WON' && !lead.consent) {
    throw new LeadRuleError('consent required for won lead');
  }
  const updated = await client.query(
    `UPDATE leads SET stage = $1, lost_reason = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4
     RETURNING id, name, email, phone, source, campaign, consent, stage, lost_reason, created_at`,
    [to, to === 'LOST' ? lostReason?.trim() : null, leadId, tenantId],
  );
  await client.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, userId ?? 'unknown', `lead.stage.${from}→${to}`, 'lead', leadId],
  );
  return toRow(updated.rows[0] as unknown as DbLead);
}
