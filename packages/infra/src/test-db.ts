/**
 * Bootstrap de Postgres de teste via testcontainers (porta efêmera).
 * Migration roda na subida; idempotência testada rodando 2×.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TestDb {
  pool: Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  const migration = readFileSync(join(process.cwd(), 'migrations/001_init.sql'), 'utf-8');
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
