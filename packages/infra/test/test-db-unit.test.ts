/**
 * Cobertura unitária de test-db.ts (findMigration) — NÃO sobe Postgres.
 * Exercita o loop de busca (catch → sobe diretório) e a falha final.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMigration, findMigrationsDir, readMigrations } from '../src/test-db.js';

describe('readMigrations / findMigrationsDir', () => {
  it('lê todas as migrations em ordem e localiza o diretório', () => {
    const root = mkdtempSync(join(tmpdir(), 'migall-'));
    const mig = join(root, 'packages/infra/migrations');
    mkdirSync(mig, { recursive: true });
    writeFileSync(join(mig, '002_b.sql'), 'B;');
    writeFileSync(join(mig, '001_a.sql'), 'A;');
    writeFileSync(join(mig, 'ignored.txt'), 'x');
    try {
      expect(readMigrations(root)).toEqual(['A;', 'B;']);
      expect(findMigrationsDir(root)).toBe(mig);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('readMigrations lança quando o diretório de migrations não existe', () => {
    const root = mkdtempSync(join(tmpdir(), 'mignodir-'));
    try {
      expect(() => readMigrations(root)).toThrow(/não encontrado/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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
