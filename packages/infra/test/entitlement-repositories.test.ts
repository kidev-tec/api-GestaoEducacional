/**
 * E13-02 — entitlements por tenant: grant idempotente, revoke, seats, período, dependências (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  EntitlementRuleError, grantEntitlement, updateEntitlement, hasEntitlement, listEntitlements, entitlementAudit, mapEntitlementError,
} from '../src/entitlement-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
const CATALOG = [
  { key: 'core', requires: [], active: true },
  { key: 'secretaria', requires: ['core'], active: true },
  { key: 'crm', requires: ['secretaria'], active: true },
  { key: 'bi', requires: ['core'], active: true },
];
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  return {
    queries,
    client: {
      query: vi.fn(async (...args: unknown[]) => {
        const q: Q = typeof args[0] === 'string'
          ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
          : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
        queries.push(q);
        return { rows: responder(q), rowCount: responder(q).length };
      }),
    } as unknown as import('pg').PoolClient & { queries: Q[] },
  };
}

describe('grantEntitlement', () => {
  it('R1-R2: valida catálogo/dependências; grant novo; reativa idempotente; seats inválidos 422', async () => {
    const entRow = { id: 'e1', tenant_id: 'T', module_key: 'crm', seats: 5, active: true, starts_at: null, ends_at: null };
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('ANY(')) return [{ module_key: 'secretaria' }, { module_key: 'core' }];
      if (q.text.includes('INSERT INTO tenant_entitlements')) return [entRow];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    const g = await grantEntitlement(client, 'T', { moduleKey: 'crm', seats: 5, note: 'contrato 1' });
    expect(g.moduleKey).toBe('crm');
    const g2 = await grantEntitlement(client, 'T', { moduleKey: 'crm', seats: 5 });
    expect(g2.active).toBe(true);
    // dependência ausente → 422
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('ANY(')) return [];
      return [];
    });
    await expect(grantEntitlement(c2, 'T', { moduleKey: 'crm' })).rejects.toThrow(/dependência/);
    // módulo inexistente no catálogo → 404
    const { client: c3 } = fakeClient(() => []);
    await expect(grantEntitlement(c3, 'T', { moduleKey: 'zz' })).rejects.toThrow(NotFoundError);
    // seats 0 → 422
    const { client: c4 } = fakeClient(() => []);
    await expect(grantEntitlement(c4, 'T', { moduleKey: 'crm', seats: 0 })).rejects.toThrow(/seats/);
    // ends_at antes de starts_at → 422
    await expect(grantEntitlement(c4, 'T', { moduleKey: 'crm', startsAt: '2026-12-01', endsAt: '2026-01-01' })).rejects.toThrow(/período/);
  });
});

describe('updateEntitlement (R3)', () => {
  const row = { id: 'e1', tenant_id: 'T', module_key: 'crm', seats: 5, active: true, starts_at: null, ends_at: null };
  it('seats down permitido (evento), revoke, activate, 404', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('SET seats =')) return [{ ...row, seats: 2 }];
      if (q.text.includes('SET active =') && q.values[2] === false) return [{ ...row, active: false }];
      if (q.text.includes('SET active =')) return [{ ...row, active: true }];
      if (q.text.includes('SELECT * FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [{ ...row }];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    const r = await updateEntitlement(client, 'T', 'crm', { seats: 2 });
    expect(r.seats).toBe(2); // redução permitida
    const rv = await updateEntitlement(client, 'T', 'crm', { active: false });
    expect(rv.active).toBe(false);
    const ac = await updateEntitlement(client, 'T', 'crm', { active: true });
    expect(ac.active).toBe(true);
    const { client: c1 } = fakeClient(() => []);
    await expect(updateEntitlement(c1, 'T', 'crm', { seats: 0 })).rejects.toThrow(/seats/);
    await expect(updateEntitlement(c1, 'T', 'zz', { seats: 3 })).rejects.toThrow(NotFoundError);
  });
});

describe('branches finais entitlements', () => {
  it('iso Date/string, requires null, deps early-return, reativa UPDATE, seats via grant, período futuro, catálogo falta', async () => {
    const entRow = { id: 'e2', tenant_id: 'T', module_key: 'bi', seats: 2, active: true, starts_at: new Date('2026-01-01'), ends_at: '2026-12-31' };
    // reativa (existing.rowCount → UPDATE path 75-83) com starts_at Date (27) e ends_at string (28)
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('ANY(')) return [{ module_key: 'core' }];
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [entRow];
      if (q.text.includes('UPDATE tenant_entitlements SET active = true')) return [{ ...entRow, seats: 3 }];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    const g = await grantEntitlement(client, 'T', { moduleKey: 'bi', seats: 3 });
    expect(g.startsAt).toBe('2026-01-01');
    expect(g.endsAt).toBe('2026-12-31');
    // reativa sem seats (ACTIVATED) e com ends_at Date
    const g3 = await grantEntitlement(client, 'T', { moduleKey: 'bi' });
    expect(g3.active).toBe(true);
    // grant simples c/ requires [] → early return (50) e module sem requires null (36)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return [{ key: 'solo', requires: null, active: true }];
      if (q.text.includes('INSERT INTO tenant_entitlements')) return [{ id: 'e3', tenant_id: 'T', module_key: 'solo', seats: null, active: true, starts_at: null, ends_at: null }];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    const g2 = await grantEntitlement(c1, 'T', { moduleKey: 'solo', seats: null });
    // seats = 1 (limite inferior válido)
    const { client: c1b } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return [{ key: 'solo', requires: null, active: true }];
      if (q.text.includes('INSERT INTO tenant_entitlements')) return [{ id: 'e4', tenant_id: 'T', module_key: 'solo', seats: 1, active: true, starts_at: null, ends_at: null }];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    await grantEntitlement(c1b, 'T', { moduleKey: 'solo', seats: 1 });
    // ends_at como STRING (false path do instanceof Date)
    const { client: c1c } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return [{ key: 'solo', requires: null, active: true }];
      if (q.text.includes('INSERT INTO tenant_entitlements')) return [{ id: 'e5', tenant_id: 'T', module_key: 'solo', seats: 1, active: true, starts_at: null, ends_at: '2027-12-31' }];
      if (q.text.includes('INSERT INTO entitlement_events')) return [];
      return [];
    });
    const g5 = await grantEntitlement(c1c, 'T', { moduleKey: 'solo' });
    expect(g5.endsAt).toBe('2027-12-31');
    expect(g2.seats).toBeNull();
    // período futuro → false (124); módulo ausente no catálogo no has → throw (128)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [{ ...entRow, starts_at: '2099-01-01' }];
      return [];
    });
    expect(await hasEntitlement(c2, 'T', 'bi')).toBe(false);
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return [];
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [entRow];
      return [];
    });
    await expect(hasEntitlement(c3, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
});

describe('hasEntitlement (R4) + list/audit', () => {
  const row = { id: 'e1', tenant_id: 'T', module_key: 'crm', seats: 5, active: true, starts_at: null, ends_at: null };
  it('ativo+dentro do período+deps concedidas; falso em cada falha; lista; audit; map', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [row];
      if (q.text.includes('ANY(')) return [{ module_key: 'secretaria' }, { module_key: 'core' }];
      if (q.text.includes('SELECT * FROM tenant_entitlements')) return [row];
      if (q.text.includes('FROM entitlement_events')) return [{ action: 'GRANTED', seats: 5, created_at: new Date() }];
      return [];
    });
    expect(await hasEntitlement(client, 'T', 'crm')).toBe(true);
    // inativa → false
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [{ ...row, active: false }];
      return [];
    });
    expect(await hasEntitlement(c1, 'T', 'crm')).toBe(false);
    // fora do período (ends_at passado) → false
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [{ ...row, ends_at: '2020-01-01' }];
      return [];
    });
    expect(await hasEntitlement(c2, 'T', 'crm')).toBe(false);
    // deps ausentes → false
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM module_catalog')) return CATALOG;
      if (q.text.includes('FROM tenant_entitlements WHERE tenant_id = $1 AND module_key = $2')) return [row];
      if (q.text.includes('ANY(')) return [];
      return [];
    });
    expect(await hasEntitlement(c3, 'T', 'crm')).toBe(false);
    // lista + audit
    const ls = await listEntitlements(client, 'T');
    expect(ls).toHaveLength(1);
    const au = await entitlementAudit(client, 'T', 'crm');
    expect(au).toHaveLength(1);
    // 404 hasEntitlement de módulo desconhecido
    const { client: c4 } = fakeClient(() => []);
    await expect(hasEntitlement(c4, 'T', 'zz')).rejects.toThrow(NotFoundError);
    // map
    expect(mapEntitlementError(new EntitlementRuleError('x')).status).toBe(422);
    expect(mapEntitlementError(new NotFoundError('x')).status).toBe(404);
    expect(mapEntitlementError(new Error('x')).status).toBe(500);
  });
});
