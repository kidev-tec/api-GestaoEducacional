/**
 * RF-021 — Guards de backup/restore local (G7 hardening).
 * Regras: DSN apenas localhost/127.0.0.1 (nunca remoto); restore exige
 * --confirm-restore; comandos pg_dump/pg_restore via spawn SEM shell.
 * Executável: node scripts/restore-local.mjs <dsn> <arquivo> --confirm-restore
 *             node scripts/restore-local.mjs <dsn> <arquivo> --confirm-restore
 */
import { spawnSync } from 'node:child_process';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Extrai componentes de postgres://user:pass@host:port/db — SEM expor senha. */
export function parseLocalDsn(dsn) {
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error('DSN inválido (esperado postgres://user:pass@host:port/db)');
  }
  const proto = url.protocol.replace(':', '');
  if (proto !== 'postgres' && proto !== 'postgresql') {
    throw new Error('protocolo deve ser postgres:// ou postgresql://');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`host não-local recusado (${url.hostname}); backup/restore só localhost/127.0.0.1`);
  }
  if (!url.username || !url.pathname || url.pathname === '/') {
    throw new Error('DSN precisa de usuário e database');
  }
  const env = {};
  if (url.password) env.PGPASSWORD = url.password;
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: url.username,
    database: url.pathname.slice(1),
    env,
  };
}

/** Restore NUNCA roda sem confirmação explícita. */
export function assertRestoreConfirmed(argv) {
  if (!argv.includes('--confirm-restore')) {
    throw new Error('restore destrutivo: rode novamente com --confirm-restore');
  }
}

/** Args do pg_dump: sem shell, password via env, arquivo de saída explícito. */
export function pgDumpArgs(dsn, outFile) {
  return [
    '--host', dsn.host,
    '--port', dsn.port,
    '--username', dsn.user,
    '--format', 'custom',
    '--file', outFile,
    dsn.database,
  ];
}

/** Args do pg_restore: sem shell, com --clean e --if-exists. */
export function pgRestoreArgs(dsn, inFile) {
  return [
    '--host', dsn.host,
    '--port', dsn.port,
    '--username', dsn.user,
    '--clean',
    '--if-exists',
    '--dbname', dsn.database,
    inFile,
  ];
}

/**
 * Ambiente MÍNIMO para pg_dump/pg_restore: herdamos apenas PATH/HOME/LANG
 * e o PGPASSWORD que nós mesmos definimos. Variáveis libpq de override
 * (PGHOST, PGSERVICE, PGPASSFILE, PGSSLCERT etc.) NUNCA são herdadas —
 * assim o DSN validado é a única fonte de conexão.
 */
const ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];

export function buildToolEnv(extra) {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  Object.assign(env, extra);
  return env;
}

export function runLocal(tool, args, env) {
  const result = spawnSync(tool, args, { env: buildToolEnv(env), stdio: 'inherit' });
  if (result.error) {
    throw new Error(`${tool} não disponível no PATH (instale o cliente PostgreSQL)`);
  }
  if (result.status !== 0) {
    throw new Error(`${tool} falhou com código ${result.status}`);
  }
}

// --- CLI (só roda como processo principal; testes importam as funções) ---
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const mode = process.argv[1].includes('restore') ? 'restore' : 'backup';
  const dsn = process.argv[2];
  const file = process.argv[3];
  if (!dsn || !file) {
    console.error(`uso: node scripts/${mode}-local.mjs <dsn-local> <arquivo>${mode === 'restore' ? ' --confirm-restore' : ''}`);
    process.exit(2);
  }
  try {
    if (mode === 'restore') assertRestoreConfirmed(process.argv);
    const parsed = parseLocalDsn(dsn);
    const args = mode === 'backup' ? pgDumpArgs(parsed, file) : pgRestoreArgs(parsed, file);
    runLocal(mode === 'backup' ? 'pg_dump' : 'pg_restore', args, parsed.env);
    console.log(`${mode} concluído: ${file}`);
  } catch (e) {
    console.error(`ERRO: ${e.message}`);
    process.exit(1);
  }
}
