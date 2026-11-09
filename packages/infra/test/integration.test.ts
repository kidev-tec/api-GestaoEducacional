/**
 * G4 — integração REAL com Postgres (testcontainers).
 * QG-3: constraints, transações, retries, concorrência, tenant crossing, idempotência.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { startTestDb, type TestDb } from '../src/test-db.js';
import {
  withTransaction,
  postLedger,
  ledgerBalance,
  createEnrollment,
  transitionEnrollment,
  getEnrollment,
  auditCount,
} from '../src/repositories.js';

let db: TestDb;
let pool: Pool;

beforeAll(async () => {
  db = await startTestDb();
  pool = db.pool;
}, 120_000);

afterAll(async () => {
  await db.teardown();
}, 120_000);

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

describe('migrations', () => {
  it('migration rodou 2× sem erro (idempotente)', () => {
    // startTestDb já rodou 2×; se chegamos aqui, passou
    expect(true).toBe(true);
  });
});

describe('ledger: idempotência e concorrência', () => {
  it('mesmo (tenant, key) em sequência → 1 lançamento, saldo constante', async () => {
    const r1 = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'PAYMENT', amountCents: 5000, idempotencyKey: 'wh-1' }),
    );
    expect(r1.idempotentReplay).toBe(false);
    const r2 = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'PAYMENT', amountCents: 5000, idempotencyKey: 'wh-1' }),
    );
    expect(r2.idempotentReplay).toBe(true);
    expect(r2.entry.id).toBe(r1.entry.id);
    expect(await ledgerBalance(pool, 'A')).toBe(5000);
  });

  it('CONCORRÊNCIA: 10 transações paralelas, mesmo (tenant, key) → exatamente 1 lançamento', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        withTransaction(pool, (c) =>
          postLedger(c, { entryId: `conc-${i}`, tenantId: 'A', type: 'PAYMENT', amountCents: 250, idempotencyKey: 'race-1' }),
        ),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ entry: { id: string }; idempotentReplay: boolean }>[];
    const rejected = results.filter((r) => r.status === 'rejected');
    // no máx 1 criou; os demais ou replaram ou conflitaram de forma segura
    const newIds = new Set(
      fulfilled.filter((r) => !r.value.idempotentReplay).map((r) => r.value.entry.id),
    );
    expect(newIds.size).toBeLessThanOrEqual(1);
    // exatamente 1 lançamento NOVO (o de wh-1 já existia antes; este teste é o 2º)
    const raceRows = await pool.query(
      "SELECT COUNT(DISTINCT id) AS n FROM ledger_entries WHERE tenant_id='A' AND amount_cents=250",
    );
    expect(Number((raceRows.rows[0] as { n: string }).n)).toBe(1);
    // rejeições, quando ocorrem, são erros limpos de conflito — nunca corrompimento
    for (const r of rejected) {
      expect((r.reason as Error).message).toBeTruthy();
    }
    // idempotência do banco: 1 única linha no índice para a key
    const idxRows = await pool.query(
      "SELECT COUNT(*) AS n FROM ledger_idempotency WHERE tenant_id='A' AND idempotency_key='race-1'",
    );
    expect(Number((idxRows.rows[0] as { n: string }).n)).toBe(1);
    // saldo é exatamente a soma dos lançamentos distintos
    const distinctSum = await pool.query(
      "SELECT COALESCE(SUM(amount_cents),0) AS b FROM ledger_entries WHERE tenant_id='A'",
    );
    expect(await ledgerBalance(pool, 'A')).toBe(Number((distinctSum.rows[0] as { b: string }).b));
  });

  it('mesma key em tenants DIFERENTES → lançamentos independentes (escopo por tenant)', async () => {
    // saldos ANTES do teste (banco compartilhado entre suítes)
    const beforeA = await ledgerBalance(pool, 'A');
    const beforeB = await ledgerBalance(pool, 'B');
    await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 111, idempotencyKey: 'shared-key' }),
    );
    const rB = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'CHARGE', amountCents: 111, idempotencyKey: 'shared-key' }),
    );
    expect(rB.idempotentReplay).toBe(false); // B não colide com A
    expect(await ledgerBalance(pool, 'A')).toBe(beforeA + 111);
    expect(await ledgerBalance(pool, 'B')).toBe(beforeB + 111);
    // segunda rodada: A repete a MESMA key → replay do original de A (não do de B)
    const rA2 = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 111, idempotencyKey: 'shared-key' }),
    );
    expect(rA2.idempotentReplay).toBe(true);
    expect(await ledgerBalance(pool, 'A')).toBe(beforeA + 111); // sem dupla contagem
  });

  it('key com payload divergente → conflito, nada gravado', async () => {
    await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'CHARGE', amountCents: 50, idempotencyKey: 'conflict-1' }),
    );
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'CHARGE', amountCents: 60, idempotencyKey: 'conflict-1' }),
      ),
    ).rejects.toThrow(/different payload/);
    const res = await pool.query("SELECT COUNT(*) AS n FROM ledger_entries WHERE tenant_id='B' AND amount_cents=60");
    expect(Number((res.rows[0] as { n: string }).n)).toBe(0);
  });

  it('float na porta é rejeitado antes do INSERT', async () => {
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 0.1 + 0.2 }),
      ),
    ).rejects.toThrow(/integer cents/);
  });

  it('rollback em falha parcial: audit do lançamento falho não persiste', async () => {
    const before = await auditCount(pool, 'A');
    await expect(
      withTransaction(pool, async (c) => {
        await postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 1 });
        throw new Error('crash no meio da transação');
      }),
    ).rejects.toThrow('crash no meio da transação');
    expect(await auditCount(pool, 'A')).toBe(before); // rollback total
    // e a transação seguinte funciona (pool não ficou travada)
    const ok = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 2 }),
    );
    expect(ok.idempotentReplay).toBe(false);
  });

  it('ROLLBACK executa e o pool sobrevive mesmo quando fn lança erro não-HTTP', async () => {
    // segundo caminho do catch: erro lançado após operações, provando ROLLBACK + release
    for (let i = 0; i < 15; i++) {
      await expect(
        withTransaction(pool, async (c) => {
          await c.query('SELECT 1');
          throw new TypeError(`boom-${i}`);
        }),
      ).rejects.toThrow(`boom-${i}`);
    }
    // pool íntegro: transação subsequente comita normalmente
    const r = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'PAYMENT', amountCents: 77 }),
    );
    expect(r.idempotentReplay).toBe(false);
    expect(await ledgerBalance(pool, 'B')).toBeGreaterThan(0);
  });

  it('REVERSAL: vínculo validado na transação; cadeia e cross-tenant bloqueados', async () => {
    const charge = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 700 }),
    );
    // reversão de outro tenant: sem oracle (mesmo erro de inexistente)
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'REVERSAL', amountCents: -700, reverses: charge.entry.id }),
      ),
    ).rejects.toThrow('reversal must reference the original entry');
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'REVERSAL', amountCents: -100, reverses: 'led-99999' }),
      ),
    ).rejects.toThrow('reversal must reference the original entry');
    // reversão correta zera
    await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'REVERSAL', amountCents: -700, reverses: charge.entry.id }),
    );
    // cadeia: reverter a reversão é bloqueado
    const revRow = await pool.query("SELECT id FROM ledger_entries WHERE type='REVERSAL' AND tenant_id='A' LIMIT 1");
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'REVERSAL', amountCents: 700, reverses: (revRow.rows[0] as { id: string }).id }),
      ),
    ).rejects.toThrow(/cannot reverse a reversal/);
  });
});

describe('enrollment: persistência e transições', () => {
  it('criação idempotente + transições com audit persistido', async () => {
    const r1 = await withTransaction(pool, (c) =>
      createEnrollment(c, { id: nextId('enr'), tenantId: 'A', studentId: 's1', offerId: 'o1', idempotencyKey: 'enr-k1' }),
    );
    expect(r1.enrollment.state).toBe('DRAFT');
    const r2 = await withTransaction(pool, (c) =>
      createEnrollment(c, { id: nextId('enr'), tenantId: 'A', studentId: 's1', offerId: 'o1', idempotencyKey: 'enr-k1' }),
    );
    expect(r2.enrollment.id).toBe(r1.enrollment.id);
    expect(r2.idempotentReplay).toBe(true);

    await withTransaction(pool, (c) =>
      transitionEnrollment(c, { id: r1.enrollment.id, to: 'PENDING_DOCUMENTS', tenantId: 'A', actorId: 'maria' }),
    );
    const rec = await getEnrollment(pool, r1.enrollment.id, 'A');
    expect(rec.state).toBe('PENDING_DOCUMENTS');
    // audit contém create + transition
    const audits = await pool.query(
      "SELECT action, actor_id FROM audit_records WHERE resource_id = $1 ORDER BY seq",
      [r1.enrollment.id],
    );
    expect(audits.rows.map((r) => (r as { action: string }).action)).toEqual([
      'enrollment.create',
      'enrollment.transition.PENDING_DOCUMENTS',
    ]);
    expect((audits.rows[1] as { actor_id: string }).actor_id).toBe('maria');
  });

  it('transição inválida rejeitada no banco, estado intacto', async () => {
    const r = await withTransaction(pool, (c) =>
      createEnrollment(c, { id: nextId('enr'), tenantId: 'A', studentId: 's2', offerId: 'o2', idempotencyKey: 'enr-k2' }),
    );
    await expect(
      withTransaction(pool, (c) =>
        transitionEnrollment(c, { id: r.enrollment.id, to: 'COMPLETED', tenantId: 'A', actorId: 'x' }),
      ),
    ).rejects.toThrow(/invalid enrollment transition/);
    const rec = await getEnrollment(pool, r.enrollment.id, 'A');
    expect(rec.state).toBe('DRAFT');
  });

  it('cross-tenant: get/transição de outro tenant = not found (sem vazar)', async () => {
    const r = await withTransaction(pool, (c) =>
      createEnrollment(c, { id: nextId('enr'), tenantId: 'A', studentId: 's3', offerId: 'o3', idempotencyKey: 'enr-k3' }),
    );
    await expect(getEnrollment(pool, r.enrollment.id, 'B')).rejects.toThrow(/not found/);
    await expect(
      withTransaction(pool, (c) =>
        transitionEnrollment(c, { id: r.enrollment.id, to: 'CANCELED', tenantId: 'B', actorId: 'atk' }),
      ),
    ).rejects.toThrow(/not found/);
    // estado de A intacto
    expect((await getEnrollment(pool, r.enrollment.id, 'A')).state).toBe('DRAFT');
  });

  it('CHECK constraint do banco rejeita estado inválido direto no SQL', async () => {
    await expect(
      pool.query("INSERT INTO enrollments (id, tenant_id, student_id, offer_id, state) VALUES ('hack-1', 'A', 's', 'o', 'HACKED')"),
    ).rejects.toThrow();
  });
});

describe('cobertura de branches de guarda (G4)', () => {
  it('REVERSAL com valor que não nega exatamente o original → erro específico', async () => {
    const charge = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'CHARGE', amountCents: 300 }),
    );
    await expect(
      withTransaction(pool, (c) =>
        postLedger(c, { entryId: nextId('led'), tenantId: 'A', type: 'REVERSAL', amountCents: -299, reverses: charge.entry.id }),
      ),
    ).rejects.toThrow('reversal amount must exactly negate the original entry');
    // nada gravado com valor errado
    const res = await pool.query("SELECT COUNT(*) AS n FROM ledger_entries WHERE type='REVERSAL' AND amount_cents=-299");
    expect(Number((res.rows[0] as { n: string }).n)).toBe(0);
  });

  it('COMMIT falha (conexão destruída pós-fn) → catch→ROLLBACK e erro propagado', async () => {
    let calls = 0;
    await expect(
      withTransaction(pool, async (c) => {
        calls++;
        await c.query('SELECT 1');
        // absorve o 'error' emitido pelo pg quando o socket morre (senão vira unhandled)
        c.on('error', () => {});
        // destrói o socket após fn resolver: COMMIT não pode completar
        (c as unknown as { connection: { stream: { destroy: () => void } } }).connection.stream.destroy();
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    // pool sobrevive à conexão morta
    const r = await withTransaction(pool, (c) =>
      postLedger(c, { entryId: nextId('led'), tenantId: 'B', type: 'PAYMENT', amountCents: 55 }),
    );
    expect(r.idempotentReplay).toBe(false);
  });

  it('getLedgerEntry inexistente → not found', async () => {
    const { getLedgerEntry } = await import('../src/repositories.js');
    await expect(withTransaction(pool, (c) => getLedgerEntry(c, 'led-inexistente-xyz', 'A'))).rejects.toThrow(/not found/);
  });

  it('enrollment: mesma key com payload divergente → conflito, nada gravado', async () => {
    await withTransaction(pool, (c) =>
      createEnrollment(c, { id: nextId('enr'), tenantId: 'B', studentId: 's1', offerId: 'o1', idempotencyKey: 'enr-conflict' }),
    );
    await expect(
      withTransaction(pool, (c) =>
        createEnrollment(c, { id: nextId('enr'), tenantId: 'B', studentId: 's2', offerId: 'o1', idempotencyKey: 'enr-conflict' }),
      ),
    ).rejects.toThrow(/reused with different payload/);
    const res = await pool.query("SELECT COUNT(*) AS n FROM enrollments WHERE tenant_id='B' AND student_id='s2' AND offer_id='o1'");
    expect(Number((res.rows[0] as { n: string }).n)).toBe(0);
  });
});
