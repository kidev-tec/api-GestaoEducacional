/**
 * Cobertura unitária de test-db.ts (findMigration) — NÃO sobe Postgres.
 * Exercita o loop de busca (catch → sobe diretório) e a falha final.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMigration } from '../src/test-db.js';

describe('findMigration', () => {
  it('encontra 001_init.sql subindo a árvore a partir de subdiretório profundo', () => {
    const root = mkdtempSync(join(tmpdir(), 'mig-'));
    const deep = join(root, 'packages/infra/src');
    mkdirSync(deep, { recursive: true });
    mkdirSync(join(root, 'packages/infra/migrations'), { recursive: true });
    writeFileSync(join(root, 'packages/infra/migrations/001_init.sql'), 'SELECT 1;');
    try {
      // cwd simulado = packages/infra/src; a busca sobe até achar
      expect(findMigration(deep)).toBe('SELECT 1;');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lança erro claro quando a migration não existe em nenhum nível', () => {
    const root = mkdtempSync(join(tmpdir(), 'mignone-'));
    try {
      expect(() => findMigration(root)).toThrow(/001_init.sql não encontrado/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
