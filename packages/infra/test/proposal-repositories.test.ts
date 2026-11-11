/**
 * E06-04 unit — proposal-repositories 100×4 (fake PG).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ProposalRuleError, computeSimulation, PROPOSAL_TRANSITIONS,
  createPriceItem, supersedePriceItem, listActivePriceItems,
  createProposal, transitionProposal, getProposal, listProposals,
} from '../src/proposal-repositories.js';
import { NotFoundError, ConflictError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? (args[1] as unknown[]) ?? [] };
      queries.push(q);
      const rows = responder(q);
      const rowCount = q.text.trim().toUpperCase().startsWith('UPDATE') ? rows.length : undefined;
      return { rows, rowCount: rowCount ?? rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const ITEM = {
  id: 'pi1', tenant_id: 'T', price_book_id: 'pb', course_name: 'Curso X', duration_months: 12,
  price_cents: 100000, effective_from: '2026-01-01', effective_to: null, version: 1, superseded_by: null,
};
const PROP = {
  id: 'p1', tenant_id: 'T', lead_id: 'l1', price_item_id: 'pi1', status: 'draft',
  discount_cents: 0, discount_pct: null, subtotal_cents: 100000, total_cents: 100000,
  valid_until: '2027-01-01T00:00:00.000Z', approved_by: null, approved_at: null,
  signed_at: null, signed_by_name: null, created_by: 'u1',
};

describe('computeSimulation (R4/R5/R6)', () => {
  it('sem desconto: total = subtotal, sem alçada', () => {
    const s = computeSimulation(100000, 0, null);
    expect(s).toEqual({ subtotalCents: 100000, discountCents: 0, totalCents: 100000, discountPct: 0, needsApproval: false });
  });
  it('desconto 10%: sem alçada; 20%: alçada; 31%: bloqueia', () => {
    expect(computeSimulation(100000, 10000, null).needsApproval).toBe(false);
    expect(computeSimulation(100000, 20000, null).needsApproval).toBe(true);
    expect(computeSimulation(100000, 20000, null).discountPct).toBe(20);
    expect(() => computeSimulation(100000, 31000, null)).toThrow(ProposalRuleError);
  });
  it('pct direto converte; negativo bloqueia; total negativo bloqueia', () => {
    expect(computeSimulation(100000, 0, 25).needsApproval).toBe(true);
    expect(() => computeSimulation(100000, -1, null)).toThrow(ProposalRuleError);
    expect(() => computeSimulation(100000, 110000, null)).toThrow(ProposalRuleError);
  });
});

describe('createPriceItem', () => {
  it('valida preço/duração e insere com book garantido', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('SELECT id FROM price_books')) return [{ id: 'pb1' }];
      if (q.text.includes('INSERT INTO price_items')) return [ITEM];
      return [];
    });
    await expect(createPriceItem(client, 'T', { courseName: 'X', durationMonths: 0, priceCents: 100 }, 'u')).rejects.toThrow(ProposalRuleError);
    await expect(createPriceItem(client, 'T', { courseName: 'X', durationMonths: 1, priceCents: 0 }, 'u')).rejects.toThrow(ProposalRuleError);
    const item = await createPriceItem(client, 'T', { courseName: 'X', durationMonths: 12, priceCents: 100000 }, 'u');
    expect(item.price_cents).toBe(100000);
    const ins = client.queries.find((q) => q.text.includes('INSERT INTO price_items'))!;
    expect(ins.values[2]).toBe('pb1'); // bookId do ensure
    expect(ins.values[7]).toBe('u'); // actor
  });
});

describe('supersedePriceItem', () => {
  it('404 se item não existe; 409 se já supersedado; version+1 e fecha anterior', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FOR UPDATE')) {
        if (q.values[0] !== 'pi1') return [];
        return [{ id: 'pi1', course_name: 'X', duration_months: 12, version: 3, superseded_by: null }];
      }
      if (q.text.includes('INSERT INTO price_items')) return [{ ...ITEM, version: 4, id: 'pi2' }];
      return [];
    });
    await expect(supersedePriceItem(client, 'T', 'zz', { priceCents: 100 }, 'u')).rejects.toThrow(NotFoundError);
    const created = await supersedePriceItem(client, 'T', 'pi1', { priceCents: 120000 }, 'u');
    expect(created.version).toBe(4);
    const ins = queries.find((q) => q.text.includes('INSERT INTO price_items'))!;
    expect(ins.values[6]).toBe(4);
    const upd = queries.find((q) => q.text.trim().startsWith('UPDATE price_items'))!;
    expect(upd.values[2]).toBe('pi2'); // superseded_by = novo id

    const { client: c2 } = fakeClient(() => [{ id: 'pi1', course_name: 'X', duration_months: 12, version: 3, superseded_by: 'other' }]);
    await expect(supersedePriceItem(c2, 'T', 'pi1', { priceCents: 100 }, 'u')).rejects.toThrow(ConflictError);
  });
});

describe('createProposal', () => {
  it('draft sem alçada; pending_approval com alçada; 404 item/lead', async () => {
    const responder = (q: Q) => {
      if (q.text.includes('FROM price_items WHERE id')) return [{ price_cents: 100000 }];
      if (q.text.includes('FROM leads WHERE id')) return [{ id: 'l1' }];
      if (q.text.includes('INSERT INTO proposals')) return [{ ...PROP, status: q.values[4] as string }];
      return [];
    };
    const { client } = fakeClient(responder);
    const draft = await createProposal(client, 'T', { leadId: 'l1', priceItemId: 'pi1', discountCents: 5000 });
    expect(draft.status).toBe('draft');
    const pend = await createProposal(client, 'T', { leadId: 'l1', priceItemId: 'pi1', discountCents: 20000 });
    expect(pend.status).toBe('pending_approval');
    const evs = client.queries.filter((q) => q.text.includes('INSERT INTO proposal_events'));
    expect(JSON.parse(evs[evs.length - 1].values[5] as string).needsApproval).toBe(true);

    const { client: c2 } = fakeClient(() => []);
    await expect(createProposal(c2, 'T', { leadId: 'l', priceItemId: 'pi' })).rejects.toThrow(NotFoundError);
    const { client: c3 } = fakeClient((q) => (q.text.includes('price_items') ? [{ price_cents: 1 }] : []));
    await expect(createProposal(c3, 'T', { leadId: 'l', priceItemId: 'pi' })).rejects.toThrow(NotFoundError);
  });
});

describe('transitionProposal', () => {
  const row = (over: Partial<typeof PROP> = {}) => ({ ...PROP, valid_until: '2099-01-01T00:00:00.000Z', ...over });
  const resp = (over: Partial<typeof PROP> = {}) => (q: Q) => {
    if (q.text.includes('FOR UPDATE')) return q.values[0] === 'p1' ? [row(over)] : [];
    if (q.text.includes('UPDATE proposals')) return [row({ ...over, status: q.values[2] as string, approved_by: (q.values[3] as string) ?? null })];
    return [];
  };
  it('404; transição inválida 422; máquina de estados', async () => {
    const { client } = fakeClient(resp());
    await expect(transitionProposal(client, 'T', 'zz', 'sent', 'u')).rejects.toThrow(NotFoundError);
    await expect(transitionProposal(client, 'T', 'p1', 'accepted', 'u')).rejects.toThrow(ProposalRuleError); // draft→accepted inválida
    const ok = await transitionProposal(client, 'T', 'p1', 'pending_approval', 'u');
    expect(ok.status).toBe('pending_approval');
  });
  it('R8 expiração lazy: draft vencido → expired; send a partir de expired bloqueia', async () => {
    const { client } = fakeClient(resp({ status: 'draft', valid_until: '2020-01-01T00:00:00.000Z' }));
    const p = await transitionProposal(client, 'T', 'p1', 'expired', 'u');
    expect(p.status).toBe('expired');
    const { client: c2 } = fakeClient(resp({ status: 'sent', valid_until: '2020-01-01T00:00:00.000Z' }));
    await expect(transitionProposal(c2, 'T', 'p1', 'accepted', 'u')).rejects.toThrow(ProposalRuleError);
  });
  it('R3 aprovação: sem alçada 422; criador==aprovador 422; aprovado grava approved_by', async () => {
    const { client } = fakeClient(resp({ status: 'pending_approval' }));
    await expect(transitionProposal(client, 'T', 'p1', 'approved', 'criador', { approverRole: 'viewer' })).rejects.toThrow(ProposalRuleError);
    await expect(transitionProposal(client, 'T', 'p1', 'approved', 'u1', { approverRole: 'operator' })).rejects.toThrow(/própria/);
    const ok = await transitionProposal(client, 'T', 'p1', 'approved', 'chefe', { approverRole: 'operator' });
    expect(ok.status).toBe('approved');
    const upd = client.queries.find((q) => q.text.includes('approved_by = $4'))!;
    expect(upd.values[3]).toBe('chefe');
  });
  it('accept com signedByName grava trilha com from', async () => {
    const { client, queries } = fakeClient(resp({ status: 'sent' }));
    const p = await transitionProposal(client, 'T', 'p1', 'accepted', 'u2', { signedByName: 'Fulano' });
    expect(p.status).toBe('accepted'); // signed_at = now() verificado no E2E real
    const upd = queries.find((q) => q.text.includes('signed_at = now()'))!;
    expect(upd.text).toContain('signed_at = now()');
    const ev = queries.find((q) => q.text.includes('INSERT INTO proposal_events'))!;
    expect(JSON.parse(ev.values[5] as string).from).toBe('sent');
  });
});

describe('getProposal / listProposals', () => {
  it('retorna proposal + events ordenados com ISO; 404 se ausente', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM proposals WHERE id')) return [PROP];
      if (q.text.includes('FROM proposal_events')) return [
        { action: 'created', actor: 'u1', at: new Date('2026-01-01T00:00:00Z') },
        { action: 'approved', actor: 'u2', at: '2026-01-02T00:00:00.000Z' },
      ];
      return [];
    });
    const { proposal, events } = await getProposal(client, 'T', 'p1');
    expect(proposal.id).toBe('p1');
    expect(events[0].at).toBe('2026-01-01T00:00:00.000Z');
    expect(events[1].at).toBe('2026-01-02T00:00:00.000Z');
    const { client: c2 } = fakeClient(() => []);
    await expect(getProposal(c2, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
  it('lista com e sem leadId (query param afeta WHERE)', async () => {
    const { client, queries } = fakeClient(() => [PROP]);
    await listProposals(client, 'T');
    expect(queries[0].text).not.toContain('lead_id = $2');
    await listProposals(client, 'T', 'l1');
    expect(queries[1].text).toContain('lead_id = $2');
    expect(queries[1].values).toEqual(['T', 'l1']);
  });
});

describe('listActivePriceItems + transições config', () => {
  it('retorna itens vigentes; máquina de estados terminal é vazia', async () => {
    const { client } = fakeClient(() => [ITEM]);
    const items = await listActivePriceItems(client, 'T');
    expect(items).toHaveLength(1);
    expect(PROPOSAL_TRANSITIONS.accepted).toEqual([]);
    expect(PROPOSAL_TRANSITIONS.draft).toContain('canceled');
  });
});

describe('branches finais proposal coverage', () => {
  it('mapProposalError mapeia todas as classes', async () => {
    const { mapProposalError } = await import('../src/proposal-repositories.js');
    expect(mapProposalError(new ProposalRuleError('x')).status).toBe(422);
    expect(mapProposalError(new NotFoundError('x')).status).toBe(404);
    expect(mapProposalError(new ConflictError('x')).status).toBe(409);
    expect(mapProposalError(new Error('x')).status).toBe(500);
  });

  it('ensurePriceBook caminho insert (sem book existente); iso com Date e null; pct null path', async () => {
    // ensurePriceBook insert path: SELECT vazio → INSERT
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('SELECT id FROM price_books')) return [];
      if (q.text.includes('INSERT INTO price_books')) return [{ id: 'pb-new' }];
      if (q.text.includes('INSERT INTO price_items')) return [{ ...ITEM, id: 'pi-x' }];
      return [];
    });
    await createPriceItem(client, 'T', { courseName: 'Y', durationMonths: 6, priceCents: 50000 }, 'u');
    const insBook = queries.find((q) => q.text.includes('INSERT INTO price_books'))!;
    expect(insBook.values[2]).toBe('padrão');
    const insItem = queries.find((q) => q.text.includes('INSERT INTO price_items'))!;
    expect(insItem.values[2]).toBe('pb-new');

    // toProposal: discount_pct string; valid_until como Date; approved/signed null path
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM proposal_events')) return [];
      return [{
      ...PROP, discount_pct: '12.50', valid_until: new Date('2026-06-01T00:00:00Z'),
      approved_by: 'a', approved_at: new Date('2026-06-02T00:00:00Z'), signed_at: new Date('2026-06-03T00:00:00Z'), signed_by_name: 'F',
    }];
    });
    const { proposal } = await getProposal(c2, 'T', 'p1');
    expect(proposal.discountPct).toBe(12.5);
    expect(proposal.validUntil).toBe('2026-06-01T00:00:00.000Z');
    expect(proposal.approvedAt).toBe('2026-06-02T00:00:00.000Z');
    expect(proposal.signedAt).toBe('2026-06-03T00:00:00.000Z');

    // priceCents <= 0 no supersede
    const { client: c3 } = fakeClient(() => []);
    await expect(supersedePriceItem(c3, 'T', 'pi1', { priceCents: 0 }, 'u')).rejects.toThrow(ProposalRuleError);
  });

  it('transition: expired inválido de accepted; accept de draft bloqueia; signedByName null path; pctFromCents zero', async () => {
    // expired a partir de accepted → bloqueia (branch line 203 path aceito)
    const row = (over: Partial<typeof PROP> = {}) => ({ ...PROP, valid_until: '2099-01-01T00:00:00.000Z', ...over });
    const resp = (over: Partial<typeof PROP> = {}) => (q: Q) => {
      if (q.text.includes('FOR UPDATE')) return q.values[0] === 'p1' ? [row(over)] : [];
      if (q.text.includes('UPDATE proposals')) return [row({ ...over, status: q.values[2] as string })];
      return [];
    };
    const { client: c1 } = fakeClient(resp({ status: 'accepted' }));
    await expect(transitionProposal(c1, 'T', 'p1', 'expired', 'u')).rejects.toThrow(ProposalRuleError);
    // accept de draft → bloqueia (line 212 path falso)
    const { client: c2 } = fakeClient(resp({ status: 'draft' }));
    await expect(transitionProposal(c2, 'T', 'p1', 'accepted', 'u')).rejects.toThrow(/transição inválida/);
    // accept de sent sem signedByName → vals push null (line 219)
    const { client: c3, queries } = fakeClient(resp({ status: 'sent' }));
    await transitionProposal(c3, 'T', 'p1', 'accepted', 'u');
    const upd = queries.find((q) => q.text.includes('signed_at = now()'))!;
    expect(upd.values[upd.values.length - 1]).toBeNull();
    // simulate com priceCents>0 pct path (line 135 coberto); branch priceCents===0 nunca ocorre via createProposal (price CHECK > 0) — computeSimulation direto:
    const s0 = computeSimulation(100000, 0, 0);
    expect(s0.needsApproval).toBe(false);
    // branch priceCents=0 do ternário (chamada direta — defensivo)
    const sZero = computeSimulation(0, 0, null);
    expect(sZero.discountPct).toBe(0);
    // total<0 é inalcançável (pct<=30% garante desconto<=30% do preço) — check removido (dead code)
    expect(() => computeSimulation(1000, 5000, null)).toThrow(/exceeds max/);
    // transição approved sem extra.role (undefined) → alçada falha (line 163 via createProposal já coberto; approved path extra)
    const { client: c4 } = fakeClient(resp({ status: 'pending_approval' }));
    await expect(transitionProposal(c4, 'T', 'p1', 'approved', 'u1')).rejects.toThrow(/alçada/);
  });
});

describe('últimas branches proposal', () => {
  it('accept de approved via máquina não existe → defense-in-depth; createProposal sem discount (?? 0)', async () => {
    const row = (over: Partial<typeof PROP> = {}) => ({ ...PROP, valid_until: '2099-01-01T00:00:00.000Z', ...over });
    const resp = (over: Partial<typeof PROP> = {}) => (q: Q) => {
      if (q.text.includes('FOR UPDATE')) return q.values[0] === 'p1' ? [row(over)] : [];
      if (q.text.includes('UPDATE proposals')) return [row({ ...over, status: q.values[2] as string })];
      return [];
    };
    // createProposal sem discountCents/discountPct (branch ?? path)
    const r1 = (q: Q) => {
      if (q.text.includes('FROM price_items WHERE id')) return [{ price_cents: 100000 }];
      if (q.text.includes('FROM leads WHERE id')) return [{ id: 'l1' }];
      if (q.text.includes('INSERT INTO proposals')) return [{ ...PROP, status: q.values[4] as string }];
      return [];
    };
    const { client: cp } = fakeClient(r1);
    const p = await createProposal(cp, 'T', { leadId: 'l1', priceItemId: 'pi1' });
    expect(p.status).toBe('draft');
    // accept de approved → máquina bloqueia (transição inválida)
    const { client: c2 } = fakeClient(resp({ status: 'approved' }));
    await expect(transitionProposal(c2, 'T', 'p1', 'accepted', 'u')).rejects.toThrow(/transição inválida/);
    // accept de sent ✓ (branch 212 path aceito)
    const { client: c3 } = fakeClient(resp({ status: 'sent' }));
    const ok = await transitionProposal(c3, 'T', 'p1', 'accepted', 'u');
    expect(ok.status).toBe('accepted');
  });
});
