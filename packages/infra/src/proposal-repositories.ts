/**
 * E06-04 — Propostas + tabela de preços versionada.
 * Regras: R1 imutável pós-sent; R2 máquina de estados; R3 alçada 15% (criador≠aprovador);
 * R4 desconto máx 30%; R5 simulate sem persistir; R7 snapshot congelado; R8 expiração lazy.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from './people-repositories.js';

export class ProposalRuleError extends Error {}
export const APPROVAL_THRESHOLD_PCT = 15;
export const MAX_DISCOUNT_PCT = 30;

export const PROPOSAL_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval', 'approved', 'canceled'],
  pending_approval: ['approved', 'canceled'],
  approved: ['sent', 'canceled'],
  sent: ['accepted', 'rejected', 'expired', 'canceled'],
  accepted: [],
  rejected: [],
  expired: [],
  canceled: [],
};

type Pg = import('pg').Pool | import('pg').PoolClient;

function mapProposalError(e: unknown): { status: number } {
  if (e instanceof ProposalRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  if (e instanceof ConflictError) return { status: 409 };
  return { status: 500 };
}

export type PriceItem = {
  id: string; tenantId: string; priceBookId: string; courseName: string;
  durationMonths: number; priceCents: number; effectiveFrom: string;
  effectiveTo: string | null; version: number; supersededBy: string | null;
};

export async function ensurePriceBook(c: Pg, tenantId: string): Promise<string> {
  const exist = await c.query('SELECT id FROM price_books WHERE tenant_id = $1 AND active = true ORDER BY created_at LIMIT 1', [tenantId]);
  if (exist.rowCount) return (exist.rows[0] as { id: string }).id;
  const r = await c.query(
    'INSERT INTO price_books (id, tenant_id, name) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, name) DO UPDATE SET active = true RETURNING id',
    [randomUUID(), tenantId, 'padrão'],
  );
  return (r.rows[0] as { id: string }).id;
}

export async function createPriceItem(c: Pg, tenantId: string, input: {
  courseName: string; durationMonths: number; priceCents: number; effectiveFrom?: string;
}, actor: string): Promise<PriceItem> {
  if (input.priceCents <= 0) throw new ProposalRuleError('price must be > 0');
  if (input.durationMonths <= 0) throw new ProposalRuleError('duration must be > 0');
  const bookId = await ensurePriceBook(c, tenantId);
  const from = input.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const r = await c.query(
    `INSERT INTO price_items (id, tenant_id, price_book_id, course_name, duration_months, price_cents, effective_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, tenant_id, price_book_id, course_name, duration_months, price_cents, effective_from::text, effective_to::text, version, superseded_by`,
    [randomUUID(), tenantId, bookId, input.courseName, input.durationMonths, input.priceCents, from, actor],
  );
  return r.rows[0] as PriceItem;
}

/** Versionamento: novo item com version+1; anterior fecha effective_to e aponta superseded_by. */
export async function supersedePriceItem(c: Pg, tenantId: string, oldId: string, input: {
  courseName?: string; durationMonths?: number; priceCents: number;
}, actor: string): Promise<PriceItem> {
  if (input.priceCents <= 0) throw new ProposalRuleError('price must be > 0');
  const cur = await c.query(
    'SELECT id, course_name, duration_months, version, superseded_by FROM price_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [oldId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError('price item não encontrado');
  const item = cur.rows[0] as { id: string; course_name: string; duration_months: number; version: number; superseded_by: string | null };
  if (item.superseded_by) throw new ConflictError('price item já foi substituído');
  const r = await c.query(
    `INSERT INTO price_items (id, tenant_id, price_book_id, course_name, duration_months, price_cents, effective_from, version, created_by)
     VALUES ($1,$2,
       (SELECT price_book_id FROM price_items WHERE id = $3 AND tenant_id = $2),
       $4,$5,$6, CURRENT_DATE, $7, $8)
     RETURNING id, tenant_id, price_book_id, course_name, duration_months, price_cents, effective_from::text, effective_to::text, version, superseded_by`,
    [randomUUID(), tenantId, oldId, input.courseName ?? item.course_name, input.durationMonths ?? item.duration_months, input.priceCents, item.version + 1, actor],
  );
  const created = r.rows[0] as PriceItem;
  await c.query(
    'UPDATE price_items SET effective_to = CURRENT_DATE - 1, superseded_by = $3 WHERE id = $1 AND tenant_id = $2',
    [oldId, tenantId, created.id],
  );
  return created;
}

export async function listActivePriceItems(c: Pg, tenantId: string): Promise<PriceItem[]> {
  const r = await c.query(
    `SELECT id, tenant_id, price_book_id, course_name, duration_months, price_cents, effective_from::text, effective_to::text, version, superseded_by
     FROM price_items WHERE tenant_id = $1 AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE) AND superseded_by IS NULL
     ORDER BY course_name, version DESC`,
    [tenantId],
  );
  return r.rows as PriceItem[];
}

export type Proposal = {
  id: string; tenantId: string; leadId: string; priceItemId: string; status: string;
  discountCents: number; discountPct: number | null; subtotalCents: number; totalCents: number;
  validUntil: string; approvedBy: string | null; approvedAt: string | null;
  signedAt: string | null; signedByName: string | null; createdBy: string;
};

type ProposalRow = {
  id: string; tenant_id: string; lead_id: string; price_item_id: string; status: string;
  discount_cents: number; discount_pct: string | null; subtotal_cents: number; total_cents: number;
  valid_until: Date | string; approved_by: string | null; approved_at: Date | string | null;
  signed_at: Date | string | null; signed_by_name: string | null; created_by: string;
};

function toProposal(r: ProposalRow): Proposal {
  const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  return {
    id: r.id, tenantId: r.tenant_id, leadId: r.lead_id, priceItemId: r.price_item_id, status: r.status,
    discountCents: r.discount_cents, discountPct: r.discount_pct == null ? null : Number(r.discount_pct),
    subtotalCents: r.subtotal_cents, totalCents: r.total_cents, validUntil: iso(r.valid_until) as string,
    approvedBy: r.approved_by, approvedAt: iso(r.approved_at), signedAt: iso(r.signed_at),
    signedByName: r.signed_by_name, createdBy: r.created_by,
  };
}

export type Simulation = {
  subtotalCents: number; discountCents: number; totalCents: number;
  discountPct: number; needsApproval: boolean;
};

/** R5: simula total sem persistir. Valida R4 (>30% = bloqueio) e flag R3 (>15% = alçada). */
export function computeSimulation(priceCents: number, discountCents: number, discountPct: number | null): Simulation {
  if (discountCents < 0) throw new ProposalRuleError('discount cannot be negative');
  const pctFromCents = priceCents > 0 ? (discountCents / priceCents) * 100 : 0;
  const pct = discountPct != null ? Math.max(pctFromCents, discountPct) : pctFromCents;
  if (pct > MAX_DISCOUNT_PCT) throw new ProposalRuleError(`discount exceeds max ${MAX_DISCOUNT_PCT}%`);
  const total = priceCents - discountCents; // >= 0 garantido: pct <= 30% implica desconto <= 30% do preço
  return {
    subtotalCents: priceCents, discountCents, totalCents: total,
    discountPct: Math.round(pct * 100) / 100, needsApproval: pct > APPROVAL_THRESHOLD_PCT,
  };
}

export type ProposalInput = {
  leadId: string; priceItemId: string;
  discountCents?: number; discountPct?: number;
  validDays?: number; actor?: string;
};

export async function createProposal(c: import('pg').PoolClient, tenantId: string, input: ProposalInput): Promise<Proposal> {
  const item = await c.query(
    `SELECT id, price_cents FROM price_items WHERE id = $1 AND tenant_id = $2
     AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE) AND superseded_by IS NULL FOR UPDATE`,
    [input.priceItemId, tenantId],
  );
  if (!item.rowCount) throw new NotFoundError('price item não encontrado ou fora de vigência');
  const lead = await c.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2', [input.leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');

  const priceCents = (item.rows[0] as { price_cents: number }).price_cents;
  const sim = computeSimulation(priceCents, input.discountCents ?? 0, input.discountPct ?? null);
  const validUntil = new Date(Date.now() + (input.validDays ?? 15) * 86_400_000);
  const actor = input.actor ?? 'system';
  const status = sim.needsApproval ? 'pending_approval' : 'draft';
  const id = randomUUID();
  const r = await c.query(
    `INSERT INTO proposals (id, tenant_id, lead_id, price_item_id, status, discount_cents, discount_pct, subtotal_cents, total_cents, valid_until, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, tenant_id, lead_id, price_item_id, status, discount_cents, discount_pct, subtotal_cents, total_cents, valid_until, approved_by, approved_at, signed_at, signed_by_name, created_by`,
    [id, tenantId, input.leadId, input.priceItemId, status, sim.discountCents,
      input.discountPct ?? null, sim.subtotalCents, sim.totalCents, validUntil, actor],
  );
  const proposal = toProposal(r.rows[0] as ProposalRow);
  await recordEvent(c, tenantId, id, 'created', actor, { status, needsApproval: sim.needsApproval });
  return proposal;
}

async function recordEvent(c: import('pg').PoolClient, tenantId: string, proposalId: string, action: string, actor: string, payload: Record<string, unknown>): Promise<void> {
  await c.query(
    'INSERT INTO proposal_events (id, tenant_id, proposal_id, action, actor, payload) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), tenantId, proposalId, action, actor, JSON.stringify(payload)],
  );
}

export async function transitionProposal(c: import('pg').PoolClient, tenantId: string, proposalId: string,
  to: string, actor: string, extra?: { approverRole?: string; signedByName?: string }): Promise<Proposal> {
  const cur = await c.query(
    'SELECT * FROM proposals WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [proposalId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError('proposta não encontrada');
  const p = toProposal(cur.rows[0] as ProposalRow);

  // R8: expiração lazy — draft/sent com valid_until no passado viram expired
  const effStatus = (p.status === 'draft' || p.status === 'sent') && new Date(p.validUntil).getTime() < Date.now()
    ? 'expired' : p.status;

  if (to !== 'expired' && !PROPOSAL_TRANSITIONS[effStatus]?.includes(to)) {
    throw new ProposalRuleError(`transição inválida: ${effStatus} → ${to}`);
  }
  if (to === 'expired' && effStatus !== 'sent' && effStatus !== 'draft' && effStatus !== 'expired') {
    throw new ProposalRuleError(`transição inválida: ${effStatus} → ${to}`);
  }
  if (to === 'approved') {
    if (extra?.approverRole !== 'operator' && extra?.approverRole !== 'admin') {
      throw new ProposalRuleError('aprovador sem alçada');
    }
    if (p.createdBy === actor) throw new ProposalRuleError('criador não pode aprovar a própria proposta'); // R3
  }

  const sets: string[] = ['status = $3', 'updated_at = now()'];
  const vals: unknown[] = [proposalId, tenantId, to];
  if (to === 'approved') { sets.push(`approved_by = $${vals.length + 1}`, 'approved_at = now()'); vals.push(actor); }
  if (to === 'accepted') { sets.push(`signed_by_name = $${vals.length + 1}`, 'signed_at = now()'); vals.push(extra?.signedByName ?? null); }
  const r = await c.query(
    `UPDATE proposals SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, lead_id, price_item_id, status, discount_cents, discount_pct, subtotal_cents, total_cents, valid_until, approved_by, approved_at, signed_at, signed_by_name, created_by`,
    vals,
  );
  const updated = toProposal(r.rows[0] as ProposalRow);
  await recordEvent(c, tenantId, proposalId, to, actor, { from: effStatus });
  return updated;
}

export async function getProposal(c: Pg, tenantId: string, proposalId: string): Promise<{ proposal: Proposal; events: Array<{ action: string; actor: string; at: string }> }> {
  const r = await c.query(
    'SELECT * FROM proposals WHERE id = $1 AND tenant_id = $2',
    [proposalId, tenantId],
  );
  if (!r.rowCount) throw new NotFoundError('proposta não encontrada');
  const ev = await c.query(
    'SELECT action, actor, at FROM proposal_events WHERE tenant_id = $1 AND proposal_id = $2 ORDER BY at ASC',
    [tenantId, proposalId],
  );
  return {
    proposal: toProposal(r.rows[0] as ProposalRow),
    events: (ev.rows as Array<{ action: string; actor: string; at: Date | string }>).map((e) => ({
      action: e.action, actor: e.actor, at: e.at instanceof Date ? e.at.toISOString() : new Date(e.at).toISOString(),
    })),
  };
}

export async function listProposals(c: Pg, tenantId: string, leadId?: string): Promise<Proposal[]> {
  const where = leadId ? 'tenant_id = $1 AND lead_id = $2' : 'tenant_id = $1';
  const r = await c.query(
    `SELECT id, tenant_id, lead_id, price_item_id, status, discount_cents, discount_pct, subtotal_cents, total_cents, valid_until, approved_by, approved_at, signed_at, signed_by_name, created_by
     FROM proposals WHERE ${where} ORDER BY created_at DESC`,
    leadId ? [tenantId, leadId] : [tenantId],
  );
  return (r.rows as ProposalRow[]).map(toProposal);
}

export { mapProposalError };
