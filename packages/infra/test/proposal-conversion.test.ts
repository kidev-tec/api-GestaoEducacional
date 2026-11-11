/**
 * E06-05 unit — convertProposal (fake PG) 100×4 nas branches novas.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConversionRuleError, convertProposal, ensureStudentFromLead, mapConversionError } from '../src/proposal-conversion.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
      queries.push(q);
      const rows = responder(q);
      const isUpdate = q.text.trim().toUpperCase().startsWith('UPDATE');
      return { rows, rowCount: isUpdate ? rows.length : rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const PROP = {
  id: 'p1', tenant_id: 'T', lead_id: 'l1', price_item_id: 'pi1', status: 'accepted', total_cents: 80000,
};
const ENR = { id: 'e1', tenantId: 'T', studentId: 's1', offerId: 'pi1', state: 'DRAFT' };

describe('ensureStudentFromLead', () => {
  it('404 lead inexistente; reutiliza person existente por email; cria quando não há', async () => {
    const { client: c0 } = fakeClient(() => []);
    await expect(ensureStudentFromLead(c0, 'T', 'zz')).rejects.toThrow(NotFoundError);
    // reutiliza
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: null }];
      if (q.text.includes('FROM units WHERE')) return [{ id: 'u1' }];
      if (q.text.includes('FROM people WHERE')) return [{ id: 's1' }];
      return [];
    });
    expect(await ensureStudentFromLead(c1, 'T', 'l1')).toBe('s1');
    // cria (com unit obrigatória)
    const { client: c2, queries } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: '999' }];
      if (q.text.includes('FROM units WHERE')) return [{ id: 'u1' }];
      if (q.text.includes('FROM people WHERE')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 's2' }];
      return [];
    });
    expect(await ensureStudentFromLead(c2, 'T', 'l1')).toBe('s2');
    const ins = queries.find((q) => q.text.includes("kind, name, email, phone) VALUES ($1,$2,$3,'STUDENT'"))!;
    expect(ins.values[3]).toBe('N'); // kind é literal STUDENT no SQL
    // tenant sem unidade → bootstrap lazy de Unidade padrão
    const { client: c3, queries: q3 } = fakeClient((q) => {
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: null }];
      if (q.text.includes('FROM units WHERE')) return [];
      if (q.text.includes('INSERT INTO units')) return [{ id: 'u-default' }];
      if (q.text.includes('FROM people WHERE')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 's3' }];
      return [];
    });
    expect(await ensureStudentFromLead(c3, 'T', 'l1')).toBe('s3');
    expect(q3.find((q) => q.text.includes('INSERT INTO units'))!.values[2]).toBe('Unidade padrão');
  });
});

describe('convertProposal', () => {
  const base = (over: Partial<typeof PROP> = {}) => (q: Q) => {
    if (q.text.includes('FROM proposals WHERE id = $1 AND tenant_id = $2 FOR UPDATE')) return q.values[0] === 'p1' ? [{ ...PROP, ...over }] : [];
    if (q.text.includes("action = 'converted'")) return [];
    if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: null }];
    if (q.text.includes('FROM units WHERE')) return [{ id: 'u1' }];
    if (q.text.includes('FROM people WHERE')) return [{ id: 's1' }];
    if (q.text.includes('FROM enrollment_idempotency WHERE')) return [];
    if (q.text.includes('INSERT INTO enrollments')) return [{ id: 'e1', tenant_id: 'T', student_id: 's1', offer_id: 'pi1', state: 'DRAFT' }];
    if (q.text.includes('INSERT INTO enrollment_idempotency')) return [{ tenant_id: 'T', idempotency_key: 'k', enrollment_id: 'e1', fingerprint: 'f' }];
    if (q.text.includes('audit_records')) return [{ id: 'a1' }];
    if (q.text.includes('INSERT INTO outbox_events')) return [{ id: 'ev1', tenant_id: 'T', type: 'enrollment.created', version: '1.0.0', payload: {}, created_at: 'x', processed_at: null, attempts: 0, next_attempt_at: null }];
    if (q.text.includes('INSERT INTO proposal_events')) return [{ id: 'pe1' }];
    if (q.text.includes('FROM proposals WHERE id = $1 AND tenant_id = $2\n  ') || (q.text.includes('SELECT id, tenant_id, lead_id') && !q.text.includes('FOR UPDATE'))) return [{ ...PROP, discount_cents: 0, discount_pct: null, subtotal_cents: 80000, valid_until: '2027-01-01T00:00:00.000Z', approved_by: null, approved_at: null, signed_at: null, signed_by_name: null, created_by: 'u1' }];
    return [];
  };
  it('C1: proposta não-accepted sem conversão prévia → 422; 404 inexistente', async () => {
    const { client: c1 } = fakeClient(base({ status: 'sent' }));
    await expect(convertProposal(c1, 'T', 'p1', 'u')).rejects.toThrow(/accepted/);
    const { client: c2 } = fakeClient(base());
    await expect(convertProposal(c2, 'T', 'zz', 'u')).rejects.toThrow(NotFoundError);
  });
  it('C3/C4: converte accepted → DRAFT, outbox + trilha; idempotencyKey correto', async () => {
    const { client, queries } = fakeClient(base());
    const r = await convertProposal(client, 'T', 'p1', 'u');
    expect(r.idempotentReplay).toBe(false);
    expect(r.enrollment.state).toBe('DRAFT');
    expect(r.enrollment.offerId).toBe('pi1');
    const idem = queries.find((q) => q.text.includes('INSERT INTO enrollment_idempotency'))!;
    expect(idem.values[1]).toBe('proposal:p1:convert');
    const ev = queries.find((q) => q.text.includes('INSERT INTO outbox_events'))!;
    expect(ev.values[2]).toBe('enrollment.created');
    expect(JSON.parse(ev.values[4] as string).proposalId).toBe('p1');
    const pe = queries.find((q) => q.text.includes('INSERT INTO proposal_events'))!;
    expect(pe.values[3]).toBe('converted');
    expect(r.proposal.status).toBe('accepted');
  });
  it('C5: já convertida (evento existe) mesmo com status mudado → replay sem novo evento', async () => {
    const responder = (q: Q) => {
      if (q.text.includes('FROM proposals WHERE id = $1 AND tenant_id = $2 FOR UPDATE')) return [{ ...PROP, status: 'accepted' }];
      if (q.text.includes("action = 'converted'")) return [{ payload: { enrollmentId: 'e-old' } }];
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: null }];
      if (q.text.includes('FROM units WHERE')) return [{ id: 'u1' }];
      if (q.text.includes('FROM people WHERE')) return [{ id: 's1' }];
      if (q.text.includes('FROM enrollment_idempotency WHERE')) return [{ enrollment_id: 'e-old', fingerprint: '["T","s1","pi1"]' }];
      if (q.text.includes('FROM enrollments WHERE')) return [{ id: 'e-old', tenant_id: 'T', student_id: 's1', offer_id: 'pi1', state: 'DRAFT' }];
      if (q.text.includes('SELECT id, tenant_id, lead_id') && !q.text.includes('FOR UPDATE')) return [{ ...PROP, discount_cents: 0, discount_pct: null, subtotal_cents: 80000, valid_until: '2027-01-01T00:00:00.000Z', approved_by: null, approved_at: null, signed_at: null, signed_by_name: null, created_by: 'u1' }];
      return [];
    };
    const { client, queries } = fakeClient(responder);
    const r = await convertProposal(client, 'T', 'p1', 'u');
    expect(r.idempotentReplay).toBe(true);
    expect(r.enrollment.id).toBe('e-old');
    expect(queries.find((q) => q.text.includes('INSERT INTO outbox_events'))).toBeUndefined();
    expect(queries.some((q) => q.values.includes('converted'))).toBe(false);
  });
  it('branches finais: iso com Date/null e discount_pct string', async () => {
    const responder = (q: Q) => {
      if (q.text.includes('FROM proposals WHERE id = $1 AND tenant_id = $2 FOR UPDATE')) return [{ ...PROP }];
      if (q.text.includes("action = 'converted'")) return [];
      if (q.text.includes('FROM leads WHERE')) return [{ id: 'l1', name: 'N', email: 'a@b.com', phone: null }];
      if (q.text.includes('FROM units WHERE')) return [{ id: 'u1' }];
      if (q.text.includes('FROM people WHERE')) return [{ id: 's1' }];
      if (q.text.includes('FROM enrollment_idempotency WHERE')) return [];
      if (q.text.includes('INSERT INTO enrollments')) return [{ id: 'e1', tenant_id: 'T', student_id: 's1', offer_id: 'pi1', state: 'DRAFT' }];
      if (q.text.includes('INSERT INTO enrollment_idempotency')) return [{ tenant_id: 'T', idempotency_key: 'k', enrollment_id: 'e1', fingerprint: 'f' }];
      if (q.text.includes('audit_records')) return [{ id: 'a1' }];
      if (q.text.includes('INSERT INTO outbox_events')) return [{ id: 'ev1', tenant_id: 'T', type: 'enrollment.created', version: '1.0.0', payload: {}, created_at: 'x', processed_at: null, attempts: 0, next_attempt_at: null }];
      if (q.text.includes('INSERT INTO proposal_events')) return [{ id: 'pe1' }];
      if (q.text.includes('SELECT id, tenant_id, lead_id') && !q.text.includes('FOR UPDATE')) return [{
        ...PROP, discount_cents: 8000, discount_pct: '10.00', subtotal_cents: 80000,
        valid_until: new Date('2027-01-01T00:00:00Z'), approved_at: new Date('2026-12-01T00:00:00Z'), signed_at: null,
        approved_by: 'a', signed_by_name: null, created_by: 'u1',
      }];
      return [];
    };
    const { client } = fakeClient(responder);
    const r = await convertProposal(client, 'T', 'p1', 'u');
    expect(r.proposal.discountPct).toBe(10);   // pct string → Number
    expect(r.proposal.validUntil).toBe('2027-01-01T00:00:00.000Z'); // Date → ISO
    expect(r.proposal.approvedAt).toBe('2026-12-01T00:00:00.000Z');
    expect(r.proposal.signedAt).toBeNull();    // null path
  });

  it('mapConversionError mapeia classes', () => {
    expect(mapConversionError(new ConversionRuleError('x')).status).toBe(422);
    expect(mapConversionError(new NotFoundError('x')).status).toBe(404);
    expect(mapConversionError(new Error('x')).status).toBe(500);
  });
});
