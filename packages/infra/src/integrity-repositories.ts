/**
 * E07-B — Integridade financeira (SPEC-E07-B-integrity-v1 FROZEN).
 * Checks estruturais append-only do ledger por tenant. Só REPORTA — nunca repara.
 */
import type { Queryable } from './plan-repositories.js';

export interface IntegrityCheck {
  reversal_target_missing: number;
  reversal_amount_mismatch: number;
  reversal_chain: number;
  duplicate_reversal: number;
  idempotency_orphan: number;
  balanced_check: 'pass' | 'fail' | 'not_applicable';
  unbalanced_entries?: number;
}

export interface IntegrityReport {
  healthy: boolean;
  checks: IntegrityCheck;
  sample: Record<string, string[]>;
}

type Row = Record<string, unknown>;

export async function financeIntegrity(client: Queryable, tenantId: string): Promise<IntegrityReport> {
  const sample: Record<string, string[]> = {};

  // RF-01a: REVERSAL fantasma — reverses inexistente ou de outro tenant
  const ghosts = await client.query(
    `SELECT r.id FROM ledger_entries r
     LEFT JOIN ledger_entries o ON o.id = r.reverses AND o.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.type = 'REVERSAL' AND r.reverses IS NOT NULL AND o.id IS NULL`,
    [tenantId],
  );
  sample.reversal_target_missing = (ghosts.rows as Row[]).map((r) => String(r.id)).slice(0, 5);

  // RF-01b: valor divergente — REVERSAL amount != -original.amount
  const mismatch = await client.query(
    `SELECT r.id FROM ledger_entries r
     JOIN ledger_entries o ON o.id = r.reverses AND o.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.type = 'REVERSAL' AND r.amount_cents != -o.amount_cents`,
    [tenantId],
  );
  sample.reversal_amount_mismatch = (mismatch.rows as Row[]).map((r) => String(r.id)).slice(0, 5);

  // RF-01c: cadeia — REVERSAL apontando pra REVERSAL
  const chains = await client.query(
    `SELECT r.id FROM ledger_entries r
     JOIN ledger_entries o ON o.id = r.reverses AND o.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.type = 'REVERSAL' AND o.type = 'REVERSAL'`,
    [tenantId],
  );
  sample.reversal_chain = (chains.rows as Row[]).map((r) => String(r.id)).slice(0, 5);

  // RF-01d: duplicada — mesmo original reversado 2+ vezes
  const dups = await client.query(
    `SELECT o.id AS id FROM ledger_entries o
     WHERE o.tenant_id = $1 AND o.type != 'REVERSAL'
     AND (SELECT COUNT(*) FROM ledger_entries r WHERE r.reverses = o.id AND r.tenant_id = o.tenant_id AND r.type = 'REVERSAL') > 1`,
    [tenantId],
  );
  sample.duplicate_reversal = (dups.rows as Row[]).map((r) => String(r.id)).slice(0, 5);

  // RF-01e: idempotência órfã — key sem entry do tenant
  const orphans = await client.query(
    `SELECT i.tenant_id || ':' || i.idempotency_key AS id FROM ledger_idempotency i
     LEFT JOIN ledger_entries e ON e.id = i.entry_id AND e.tenant_id = i.tenant_id
     WHERE i.tenant_id = $1 AND e.id IS NULL`,
    [tenantId],
  );
  sample.idempotency_orphan = (orphans.rows as Row[]).map((r) => String(r.id)).slice(0, 5);

  // RF-02: partidas equilibradas — só se o tenant usa account
  const usage = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(account)::int AS with_account FROM ledger_entries WHERE tenant_id = $1`,
    [tenantId],
  );
  const { total, with_account: withAccount } = usage.rows[0] as { total: number; with_account: number };
  let balancedCheck: IntegrityCheck['balanced_check'] = 'not_applicable';
  let unbalanced: number | undefined;
  if (total > 0 && withAccount === total) {
    const unbal = await client.query(
      `SELECT doc_id, SUM(amount_cents) AS net FROM ledger_entries
       WHERE tenant_id = $1 AND doc_id IS NOT NULL AND account IS NOT NULL
       GROUP BY doc_id HAVING SUM(amount_cents) != 0`,
      [tenantId],
    );
    unbalanced = (unbal.rows as Row[]).length;
    balancedCheck = unbalanced === 0 ? 'pass' : 'fail';
    if (unbalanced > 0) sample.unbalanced_entries = (unbal.rows as Row[]).map((r) => String(r.doc_id)).slice(0, 5);
  }

  const counts: IntegrityCheck = {
    reversal_target_missing: ghosts.rowCount ?? 0,
    reversal_amount_mismatch: mismatch.rowCount ?? 0,
    reversal_chain: chains.rowCount ?? 0,
    duplicate_reversal: dups.rowCount ?? 0,
    idempotency_orphan: orphans.rowCount ?? 0,
    balanced_check: balancedCheck,
    ...(unbalanced !== undefined ? { unbalanced_entries: unbalanced } : {}),
  };
  const healthy =
    counts.reversal_target_missing === 0 &&
    counts.reversal_amount_mismatch === 0 &&
    counts.reversal_chain === 0 &&
    counts.duplicate_reversal === 0 &&
    counts.idempotency_orphan === 0 &&
    balancedCheck !== 'fail';
  return { healthy, checks: counts, sample };
}
