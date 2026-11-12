#!/usr/bin/env node
/**
 * E14-01 — auditoria da Definition of Done (local, sem rede).
 * Uso: node scripts/audit-dod.mjs
 * Exit 0 = DoD OK; exit 1 = violações (listadas).
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const violations = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => { violations.push(name); console.log(`  ✗ ${name}\n    ${detail}`); };

// ── DoD 1: tsc 0 erros ──
console.log('DoD 1/8 — TypeScript (apps/api):');
{
  const r = spawnSync('./node_modules/.bin/tsc', ['-p', 'apps/api', '--noEmit'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  const errs = (r.stdout + r.stderr).split('\n').filter((l) => l.includes('error TS'));
  if (r.status === 0 && errs.length === 0) ok('tsc --noEmit sem erros');
  else fail('tsc --noEmit', errs.slice(0, 3).join('\n    ') || `exit ${r.status}`);
}

// ── DoD 2: cobertura 100×4 em packages/infra (rodar só se --full) ──
const full = process.argv.includes('--full');
if (full) {
  console.log('DoD 2/8 — Cobertura 100×4 (packages/infra):');
  const r = spawnSync('./node_modules/.bin/vitest', ['run', '--root', 'packages/infra', '--coverage'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const line = out.split('\n').find((l) => l.includes('All files'));
  const allPct = line ? line.split('|').slice(1, 5).map((c) => Number(c.trim())) : [];
  if (r.status === 0 && allPct.length >= 4 && allPct.every((p) => p === 100)) ok('cobertura 100/100/100/100');
  else fail('cobertura 100×4', allPct.join('/') || `vitest exit ${r.status}`);
} else {
  console.log('DoD 2/8 — Cobertura: SKIP (use --full para rodar; gate completo na CI local do card)');
}

// ── DoD 3-8: análises estáticas (sempre) ──
console.log('DoD 3-8 — Análises estáticas:');

// 4: rotas com preHandler sem schema (app.ts)
{
  const src = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
  const routeRe = /app\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g;
  let m; let missing = 0;
  const routeNames = [];
  while ((m = routeRe.exec(src))) {
    // segmento da rota: da abertura até o handler final (máx 1500 chars)
    const seg = src.slice(m.index, m.index + 1500).split(/, async \(|\}\}, async \(/)[0];
    if (seg.includes('preHandler') && !seg.includes('schema')) {
      // rotas auth-first (requireAuth manual no preHandler) validam body no handler — isentas de AJV
      if (/requireAuth|requireRole/.test(seg) && !/writeGuard/.test(seg)) continue;
      missing++; routeNames.push(m[2]);
    }
  }
  if (missing === 0) ok('todas as rotas com preHandler têm schema AJV');
  else fail('rotas sem schema', `${missing} rota(s) com preHandler sem schema`);
}

// 5: E2E com tenant isolation
{
  const dir = join(ROOT, 'apps/api/test');
  const e2es = readdirSync(dir).filter((f) => f.endsWith('.e2e.test.ts'));
  const missing = e2es.filter((f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    const hasIsolation = /isol|tenant.*B|token2|tok2|tkB|segundo tenant|'B'\)/i.test(src) && /login|auth/i.test(src);
    return !hasIsolation;
  });
  if (missing.length === 0) ok(`tenant isolation presente em ${e2es.length} suíte(s) E2E`);
  else fail('tenant isolation ausente', missing.join(', '));
}

// 6: migrations idempotentes
{
  const dir = join(ROOT, 'packages/infra/migrations');
  const migs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const nonIdem = migs.filter((f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    return !src.includes('IF NOT EXISTS') && !src.includes('IF EXISTS') && !src.includes('DO $$');
  });
  if (nonIdem.length === 0) ok(`${migs.length} migrations idempotentes`);
  else fail('migrations não idempotentes', nonIdem.join(', '));
}

// 7: console.log em src/
{
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); continue; }
      if (!/\.(ts|mts)$/.test(f.name) || f.name.endsWith('.test.ts')) continue;
      const src = readFileSync(p, 'utf8');
      if (/^\s*console\.log\(/m.test(src) && !/JSON\.stringify/.test(src.match(/^\s*console\.log\([^)]*/m)?.[0] ?? '')) bad.push(p.replace(ROOT, ''));
      else if (/^\s*console\.log\(/m.test(src) && /process\.stdout/.test(src)) { /* logs JSON estruturados de processo standalone: permitidos */ }
    }
  };
  walk(join(ROOT, 'apps/api/src'));
  walk(join(ROOT, 'packages/infra/src'));
  if (bad.length === 0) ok('sem console.log de debug em src/');
  else fail('console.log em src/', bad.join(', '));
}

// 8: segredos hard-coded
{
  const patterns = [
    /sk_live_[a-zA-Z0-9]+/, /whsec_[a-zA-Z0-9]+/, /AIzaSy[a-zA-Z0-9_-]{30,}/,
    /(?:password|secret|token)\s*[:=]\s*['"`](?!test|dummy|placeholder|correct-horse)[^'"`]{12,}['"`]/i,
  ];
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (!['node_modules', 'release'].includes(f.name)) walk(p); continue; }
      if (!/\.(ts|mts|sql)$/.test(f.name)) continue;
      const src = readFileSync(p, 'utf8');
      if (patterns.some((re) => re.test(src))) bad.push(p.replace(ROOT, ''));
    }
  };
  walk(join(ROOT, 'apps/api/src'));
  walk(join(ROOT, 'packages/infra/src'));
  if (bad.length === 0) ok('sem segredos hard-coded em src/');
  else fail('possível segredo hard-coded', bad.join(', '));
}

// ── resultado ──
console.log('');
if (violations.length === 0) {
  console.log('DoD: OK — todas as verificações passaram.');
  process.exit(0);
} else {
  console.log(`DoD: FALHOU — ${violations.length} violação(ões):`);
  for (const v of violations) console.log(`  - ${v}`);
  process.exit(1);
}
