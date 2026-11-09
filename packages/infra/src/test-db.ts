/**
 * Bootstrap de Postgres de teste via testcontainers (porta efêmera).
 * Migration roda na subida; idempotência testada rodando 2×.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Localiza packages/infra/migrations/001_init.sql subindo a árvore (independe de cwd). */
function findMigration(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'packages/infra/migrations/001_init.sql');
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error('packages/infra/migrations/001_init.sql não encontrado a partir de ' + process.cwd());
}

export interface TestDb {
  pool: Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  const migration = findMigration();
  // roda 2×: prova idempotência da migration (QG-3)
  await pool.query(migration);
  await pool.query(migration);

  // tenants de teste
  await pool.query("INSERT INTO tenants (id) VALUES ('A'), ('B') ON CONFLICT DO NOTHING");

  return {
    pool,
    container,
    teardown: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
