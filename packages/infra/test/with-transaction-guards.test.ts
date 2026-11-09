/**
 * Branches de exceção de withTransaction (repositories.ts) — mock puro, sem Postgres.
 * Cobre: fn lançando (ROLLBACK ok), ROLLBACK falhando sem esconder o erro
 * original, release() lançando no finally e pool.connect() rejeitando.
 */
import { describe, it, expect } from 'vitest';
import { withTransaction } from '../src/repositories.js';
import type { PoolClient } from 'pg';

function fakeClient(overrides: {
  rollbackFails?: boolean;
  releaseThrows?: boolean;
  released?: () => void;
  queries?: string[];
}): PoolClient {
  return {
    query: async (sql: string) => {
      overrides.queries?.push(sql);
      if (sql === 'ROLLBACK' && overrides.rollbackFails) throw new Error('conn morta no rollback');
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      if (overrides.releaseThrows) throw new Error('release falhou');
      overrides.released?.();
    },
  } as unknown as PoolClient;
}

describe('withTransaction: falhas de transação (branches)', () => {
  it('fn lança → ROLLBACK ok → erro original propagado e client liberado', async () => {
    const queries: string[] = [];
    let released = false;
    const client = fakeClient({ queries, released: () => { released = true; } });
    const pool = { connect: async () => client } as never;
    await expect(
      withTransaction(pool, async () => {
        throw new Error('fn falhou');
      }),
    ).rejects.toThrow('fn falhou');
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(released).toBe(true);
  });

  it('ROLLBACK falhando NÃO esconde o erro original (guarda de robustez)', async () => {
    const queries: string[] = [];
    let released = false;
    const client = fakeClient({ rollbackFails: true, queries, released: () => { released = true; } });
    const pool = { connect: async () => client } as never;
    await expect(
      withTransaction(pool, async () => {
        throw new Error('fn falhou');
      }),
    ).rejects.toThrow(/fn falhou|conn morta/); // erro propaga; rollback não enriquece nem esconde
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(released).toBe(true);
  });

  it('release() lançando no finally APÓS catch (fn lançou) → erro de release substitui', async () => {
    const client = fakeClient({ releaseThrows: true });
    const pool = { connect: async () => client } as never;
    await expect(
      withTransaction(pool, async () => {
        throw new Error('fn falhou antes');
      }),
    ).rejects.toThrow('release falhou');
  });

  it('release() lançando no finally → erro de release substitui o resultado', async () => {
    const client = fakeClient({ releaseThrows: true });
    const pool = { connect: async () => client } as never;
    await expect(
      withTransaction(pool, async () => 'valor'),
    ).rejects.toThrow('release falhou');
  });

  it('pool.connect() rejeitando → erro propagado sem entrar no try (finally não roda)', async () => {
    const pool = { connect: async () => { throw new Error('pool esgotado'); } } as never;
    await expect(
      withTransaction(pool, async () => 'nunca executa'),
    ).rejects.toThrow('pool esgotado');
  });
});
