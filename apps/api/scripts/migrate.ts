/**
 * E07-B/Deploy — aplica migrations idempotentes (001..007) contra DATABASE_URL.
 * Usado no boot do container (Dockerfile.api CMD) antes do server.
 * Migrations do repo são idempotentes (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
 * então re-executar no boot é seguro. Tenants seed: igual test-db (A/B/C em dev;
 * produção cria tenants próprios via CP futura — seed só roda se tabela vazia).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL é obrigatório para rodar migrations.');
  process.exit(1);
}

function findMigrationsDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'packages', 'infra', 'migrations');
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error(`migrations não encontradas a partir de ${startDir}`);
}

const pool = new Pool({ connectionString: DATABASE_URL });
try {
  // Postgres no compose aceita a porta antes de estar pronto (initdb) — retry com backoff
  for (let attempt = 1, delays = [1, 2, 4, 8, 15] as const; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt > delays.length) throw e;
      const d = delays[attempt - 1]!;
      console.log(`[migrate] db não pronto (tentativa ${attempt}), aguardando ${d}s`);
      await new Promise((r) => setTimeout(r, d * 1000));
    }
  }
  const dir = findMigrationsDir(process.cwd());
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf-8');
    // Arquivo inteiro em um pool.query: multi-statement funciona no pg (simple query protocol).
    // Migrations são idempotentes por design (IF NOT EXISTS / DO NOTHING).
    await pool.query(sql);
    console.log(`[migrate] ${f} ok`);
  }
  console.log(`[migrate] ${files.length} migrations aplicadas`);
  process.exit(0);
} catch (e) {
  console.error('[migrate] FALHOU:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await pool.end();
}
