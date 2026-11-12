/**
 * E14-01 — testes do audit-dod (validação estática das regras do script).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts', 'audit-dod.mjs');

function run(args: string[] = []): { status: number; out: string } {
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', timeout: 120_000 });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status ?? 1, out: err.stdout + err.stderr };
  }
}

describe('audit-dod', () => {
  it('executa as verificações estáticas e lista resultados por DoD', () => {
    const r = run();
    expect(r.out).toMatch(/DoD 1\/8/);
    expect(r.out).toMatch(/DoD 3-8/);
    expect(r.out).toMatch(/todas as rotas com preHandler têm schema|rotas sem schema/);
    expect(r.out).toMatch(/migrations idempotentes|migrations não idempotentes/);
    expect(r.out).toMatch(/sem segredos hard-coded|possível segredo/);
    expect([0, 1]).toContain(r.status);
    expect(r.out).toMatch(/DoD: (OK|FALHOU)/);
  }, 180_000);

  it('--full roda a camada de cobertura e reporta SKIP quando ausente', () => {
    const r = run(); // sem --full
    expect(r.out).toMatch(/SKIP/);
  }, 180_000);
});
