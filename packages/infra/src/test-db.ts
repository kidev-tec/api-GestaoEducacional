/**
 * Bootstrap de Postgres de teste via testcontainers (porta efêmera).
 * Migrations rodam na subida (todas, em ordem); idempotência testada rodando 2×.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Localiza packages/infra/migrations subindo a árvore (independe de cwd). */
export function findMigrationsDir(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'packages/infra/migrations');
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error('packages/infra/migrations não encontrado a partir de ' + startDir);
}

/** Lê todas as migrations em ordem alfabética (001_init.sql, 002_auth.sql, ...). */
export function readMigrations(startDir: string = process.cwd()): string[] {
  const dir = findMigrationsDir(startDir);
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf-8'));
}

/**
 * Compat (E04-A): conteúdo SQL de uma migration específica subindo a árvore.
 * Preservado porque testes e callers externos dependem do export.
 */
export function findMigration(startDir: string = process.cwd(), filename: string = '001_init.sql'): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    try {
      return readFileSync(join(dir, 'packages/infra/migrations', filename), 'utf-8');
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error(`${filename} não encontrado a partir de ${startDir}`);
}

export interface TestDb {
  pool: Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  const migrations = readMigrations();
  // 1ª passada: cria schema
  for (const sql of migrations) {
    await pool.query(sql);
  }
  // tenants de teste ANTES da 2ª passada: bootstrap por tenant (DO block da 010)
  // precisa enxergá-los; a 2ª passada continua provando idempotência (QG-3).
  await pool.query("INSERT INTO tenants (id) VALUES ('A'), ('B'), ('C') ON CONFLICT DO NOTHING");
  for (const sql of migrations) {
    await pool.query(sql);
  }

  return {
    pool,
    container,
    teardown: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
