/**
 * E06-05 — Converter proposta accepted em matrícula (reuso: createEnrollment, appendOutbox).
 * C1 só accepted; C2 person do lead (cria se preciso) + offer=price_item; C3 idempotência
 * proposal:{id}:convert; C4 transação única + outbox enrollment.created; C5 terminal; C6 tenant.
 */
import { enqueueOutbox as appendOutbox } from './outbox-repositories.js';
import { createEnrollment } from './repositories.js';
import { NotFoundError } from './people-repositories.js';
import { randomUUID } from 'node:crypto';
import type { Proposal } from './proposal-repositories.js';

export class ConversionRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapConversionError(e: unknown): { status: number } {
  if (e instanceof ConversionRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

export type ConversionResult = {
  enrollment: { id: string; tenantId: string; studentId: string; offerId: string; state: string };
  idempotentReplay: boolean;
  proposal: Proposal;
};

/** C2: garante person STUDENT a partir do lead (reutiliza existente por email; cria se preciso). */
export async function ensureStudentFromLead(c: PoolClient, tenantId: string, leadId: string): Promise<string> {
  const lead = await c.query('SELECT id, name, email, phone FROM leads WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  const l = lead.rows[0] as { id: string; name: string; email: string; phone: string | null };
  const unit = await c.query('SELECT id FROM units WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [tenantId]);
  // Conversão deve ser acionável no CRM recém-criado: bootstrap lazy da unidade padrão.
  const unitId = unit.rowCount
    ? (unit.rows[0] as { id: string }).id
    : (await c.query(
      'INSERT INTO units (id, tenant_id, name) VALUES ($1,$2,$3) RETURNING id',
      [randomUUID(), tenantId, 'Unidade padrão'],
    )).rows[0] as { id: string };
  const resolvedUnitId = typeof unitId === 'string' ? unitId : unitId.id;
  const exist = await c.query("SELECT id FROM people WHERE tenant_id = $1 AND email = $2 AND kind = 'STUDENT' LIMIT 1", [tenantId, l.email]);
  if (exist.rowCount) return (exist.rows[0] as { id: string }).id;
  const created = await c.query(
    "INSERT INTO people (id, tenant_id, unit_id, kind, name, email, phone) VALUES ($1,$2,$3,'STUDENT',$4,$5,$6) RETURNING id",
    [randomUUID(), tenantId, resolvedUnitId, l.name, l.email, l.phone],
  );
  return (created.rows[0] as { id: string }).id;
}

/** Converte proposta accepted em matrícula DRAFT (idempotente por proposta). */
export async function convertProposal(c: PoolClient, tenantId: string, proposalId: string, actor: string): Promise<ConversionResult> {
  const cur = await c.query('SELECT * FROM proposals WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [proposalId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('proposta não encontrada');
  const p = cur.rows[0] as { id: string; tenant_id: string; lead_id: string; price_item_id: string; status: string; total_cents: number };
  // C1: só accepted (ou já convertida → replay C3/C5)
  const conv = await c.query(
    "SELECT payload FROM proposal_events WHERE tenant_id = $1 AND proposal_id = $2 AND action = 'converted' ORDER BY at DESC LIMIT 1",
    [tenantId, proposalId],
  );
  if (p.status !== 'accepted' && !conv.rowCount) throw new ConversionRuleError(`só proposta accepted converte (atual: ${p.status})`);

  const idempotencyKey = `proposal:${proposalId}:convert`; // C3
  const studentId = await ensureStudentFromLead(c, tenantId, p.lead_id);
  const { enrollment, idempotentReplay } = await createEnrollment(c, {
    id: randomUUID(), tenantId, studentId, offerId: p.price_item_id, idempotencyKey,
  });
  if (!idempotentReplay) {
    await appendOutbox(c, {
      tenantId, type: 'enrollment.created', version: '1.0.0',
      payload: { enrollmentId: enrollment.id, proposalId: p.id, totalCents: p.total_cents, priceItemId: p.price_item_id, studentId },
    });
    await c.query(
      'INSERT INTO proposal_events (id, tenant_id, proposal_id, action, actor, payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), tenantId, proposalId, 'converted', actor, JSON.stringify({ enrollmentId: enrollment.id })],
    );
  }
  const proposalRow = await c.query(
    'SELECT id, tenant_id, lead_id, price_item_id, status, discount_cents, discount_pct, subtotal_cents, total_cents, valid_until, approved_by, approved_at, signed_at, signed_by_name, created_by FROM proposals WHERE id = $1 AND tenant_id = $2',
    [proposalId, tenantId],
  );
  const pr = proposalRow.rows[0] as { id: string; tenant_id: string; lead_id: string; price_item_id: string; status: string; discount_cents: number; discount_pct: string | null; subtotal_cents: number; total_cents: number; valid_until: Date | string; approved_by: string | null; approved_at: Date | string | null; signed_at: Date | string | null; signed_by_name: string | null; created_by: string };
  const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  const proposal: Proposal = {
    id: pr.id, tenantId: pr.tenant_id, leadId: pr.lead_id, priceItemId: pr.price_item_id, status: pr.status,
    discountCents: pr.discount_cents, discountPct: pr.discount_pct == null ? null : Number(pr.discount_pct),
    subtotalCents: pr.subtotal_cents, totalCents: pr.total_cents, validUntil: iso(pr.valid_until) as string,
    approvedBy: pr.approved_by, approvedAt: iso(pr.approved_at), signedAt: iso(pr.signed_at),
    signedByName: pr.signed_by_name, createdBy: pr.created_by,
  };
  return { enrollment: { id: enrollment.id, tenantId: enrollment.tenantId, studentId: enrollment.studentId, offerId: enrollment.offerId, state: enrollment.state }, idempotentReplay, proposal };
}
