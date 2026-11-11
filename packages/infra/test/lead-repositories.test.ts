/**
 * E06-A complemento — unit de lead-repositories (cobertura 100×4 exige por arquivo).
 */
import { describe, expect, it, vi } from 'vitest';
import { createLead, listLeads, moveLeadStage, LeadRuleError } from '../src/lead-repositories.js';
import { ConflictError, NotFoundError } from '../src/people-repositories.js';

type Row = Record<string, unknown>;
interface Q { text: string; values: unknown[] }

function fakeClient(script: (q: Q) => Row[] | undefined) {
  const queries: Q[] = [];
  const client = {
    query: vi.fn(async (q: Q | string, values?: unknown[]) => {
      const norm: Q = typeof q === 'string' ? { text: q, values: values ?? [] } : { ...q, values: q.values ?? values ?? [] };
      queries.push(norm);
      if (norm.text.includes('COUNT(*)')) return { rows: [{ n: 1 }], rowCount: 1 };
      const rows = script(norm) ?? [];
      return { rows, rowCount: rows.length };
    }),
  };
  return { client: client as unknown as import('pg').PoolClient, queries };
}

const LEAD = { id: 'l1', name: 'Ana', email: 'ana@x.com', phone: null, source: 'website', campaign: null, consent: true, stage: 'NEW', lost_reason: null, created_at: '2026-01-01' };

describe('createLead', () => {
  it('valida nome/email (LeadRuleError)', async () => {
    const { client } = fakeClient(() => []);
    await expect(createLead(client, 'T', { name: '', email: 'a@b.com', source: 'website' })).rejects.toThrow(LeadRuleError);
    await expect(createLead(client, 'T', { name: 'X', email: 'invalid', source: 'website' })).rejects.toThrow(LeadRuleError);
    await expect(createLead(client, 'T', { name: 'X', email: 'a@b.com', source: 'bad' as 'website' })).rejects.toThrow(LeadRuleError);
  });
  it('insere lead e mapeia row', async () => {
    const { client } = fakeClient((q) => (q.text.includes('INSERT INTO leads') ? [LEAD] : []));
    const lead = await createLead(client, 'T', { name: 'Ana', email: 'ana@x.com', source: 'website', consent: true });
    expect(lead.email).toBe('ana@x.com');
  });
  it('409 em duplicado', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('SELECT id FROM leads')) return [{ id: 'dup' }];
      return [];
    });
    await expect(createLead(client, 'T', { name: 'A', email: 'ana@x.com', source: 'website' })).rejects.toThrow(ConflictError);
  });
});

describe('listLeads', () => {
  it('lista sem filtros e clampa limit', async () => {
    const { client, queries } = fakeClient(() => [LEAD]);
    const r = await listLeads(client, 'T', { limit: 500 });
    expect(r.leads).toHaveLength(1);
    expect(r.total).toBe(1);
    const q = queries[0];
    expect(q.text).toContain('LIMIT 100');
  });
  it('filtros stage/source aplicados', async () => {
    const { client, queries } = fakeClient(() => [LEAD]);
    await listLeads(client, 'T', { stage: 'WON', source: 'referral', limit: 10, offset: 5 });
    const q = queries[0];
    expect(q.text).toContain('stage =');
    expect(q.text).toContain('source =');
    expect(q.values).toEqual(['T', 'WON', 'referral']);
    expect(q.text).toContain('LIMIT 10 OFFSET 5');
  });
});

describe('moveLeadStage', () => {
  it('404 lead inexistente', async () => {
    const { client } = fakeClient(() => []);
    await expect(moveLeadStage(client, 'T', 'l', 'WON')).rejects.toThrow(NotFoundError);
  });
  it('stage inválido rejeita', async () => {
    const { client } = fakeClient(() => [{ stage: 'NEW', consent: true }]);
    await expect(moveLeadStage(client, 'T', 'l', 'ZZZ' as 'WON')).rejects.toThrow(LeadRuleError);
  });
  it('WON sem consent → 403 LeadRuleError', async () => {
    const { client } = fakeClient(() => [{ stage: 'NEW', consent: false }]);
    await expect(moveLeadStage(client, 'T', 'l', 'WON')).rejects.toThrow(/consent/);
  });
  it('LOST exige reason ≥ 3', async () => {
    const { client } = fakeClient(() => [{ stage: 'NEW', consent: true }]);
    await expect(moveLeadStage(client, 'T', 'l', 'LOST', 'ab')).rejects.toThrow(LeadRuleError);
  });
  it('não adjacente rejeita', async () => {
    const { client } = fakeClient(() => [{ stage: 'NEW', consent: true }]);
    await expect(moveLeadStage(client, 'T', 'l', 'QUALIFIED')).rejects.toThrow(LeadRuleError);
  });
  it('transição válida atualiza e audita', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, stage, consent')) return [{ stage: 'NEW', consent: true }];
      if (q.text.includes('UPDATE leads')) return [{ ...LEAD, stage: 'CONTACTED' }];
      return [];
    });
    const lead = await moveLeadStage(client, 'T', 'l1', 'CONTACTED', undefined, 'u1');
    expect(lead.stage).toBe('CONTACTED');
    expect(queries.some((q) => q.text.includes('audit'))).toBe(true);
  });
});

describe('createLead branches extras', () => {
  it('phone longo, campaign longa, fallbacks e ADJACENT default', async () => {
    const { client } = fakeClient(() => [LEAD]);
    await expect(createLead(client, 'T', { name: 'X', email: 'a@b.com', source: 'website', phone: '1'.repeat(21) })).rejects.toThrow(/phone/);
    await expect(createLead(client, 'T', { name: 'X', email: 'a@b.com', source: 'website', campaign: 'c'.repeat(121) })).rejects.toThrow(/campaign/);
    // phone/campaign undefined explícito
    const lead = await createLead(client, 'T', { name: ' Y ', email: 'a@b.com', source: 'event' });
    expect(lead.name).toBe('Ana');
  });
  it('LOST válido com reason ok, WON com consent', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, stage, consent')) return [{ stage: 'QUALIFIED', consent: true }];
      if (q.text.includes('UPDATE leads')) return [{ ...LEAD, stage: 'LOST', lost_reason: 'preço alto demais' }];
      return [];
    });
    const r = await moveLeadStage(client, 'T', 'l', 'LOST', 'preço alto demais', 'u');
    expect(r.stage).toBe('LOST');
    const { client: c2 } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, stage, consent')) return [{ stage: 'QUALIFIED', consent: true }];
      if (q.text.includes('UPDATE leads')) return [{ ...LEAD, stage: 'WON' }];
      return [];
    });
    const w = await moveLeadStage(c2, 'T', 'l', 'WON');
    expect(w.stage).toBe('WON');
  });
  it('adjacency fallback e lead fechado', async () => {
    const { client } = fakeClient(() => [{ stage: 'NEW', consent: true }]);
    // NEW→QUALIFIED: ADJACENT['NEW'] não inclui QUALIFIED → rejeita
    await expect(moveLeadStage(client, 'T', 'l', 'QUALIFIED')).rejects.toThrow(LeadRuleError);
    const { client: c2 } = fakeClient(() => [{ stage: 'WON', consent: true }]);
    await expect(moveLeadStage(c2, 'T', 'l', 'LOST')).rejects.toThrow(/closed/);
  });
});

describe('branches finais lead', () => {
  it('email ?? "" path, limit negativo clamp e ADJACENT hit', async () => {
    const { client } = fakeClient(() => [LEAD]);
    await expect(createLead(client, 'T', { name: 'X', email: undefined as unknown as string, source: 'website' })).rejects.toThrow(LeadRuleError);
    const r = await listLeads(client, 'T', { limit: -5, offset: -2 });
    const dflt = await listLeads(client, 'T');
    expect(dflt.leads).toHaveLength(1);
    expect(r.leads).toHaveLength(1);
    // ADJACENT[from] definido: CONTACTED→QUALIFIED
    const { client: c2 } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id, stage, consent')) return [{ stage: 'CONTACTED', consent: true }];
      if (q.text.includes('UPDATE leads')) return [{ ...LEAD, stage: 'QUALIFIED' }];
      return [];
    });
    const moved = await moveLeadStage(c2, 'T', 'l', 'QUALIFIED');
    expect(moved.stage).toBe('QUALIFIED');
  });
});
