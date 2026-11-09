/**
 * RF-021 — Guards de backup/restore local. Testes unitários dos guards:
 * NÃO roda pg_dump/psql contra banco real — só valida DSN/args/confirmação.
 */
import { describe, it, expect } from 'vitest';
import {
  parseLocalDsn,
  assertRestoreConfirmed,
  pgDumpArgs,
  pgRestoreArgs,
} from '../../scripts/backup-local.mjs';

const LOCAL = 'postgres://erp:secret@127.0.0.1:55432/erp_dev';

describe('parseLocalDsn', () => {
  it('aceita DSN localhost e NÃO expõe a senha (vai por env PGPASSWORD)', () => {
    const parsed = parseLocalDsn(LOCAL);
    expect(parsed).toMatchObject({ host: '127.0.0.1', port: '55432', user: 'erp', database: 'erp_dev' });
    expect(parsed.env.PGPASSWORD).toBe('secret');
    expect(JSON.stringify(parsed)).not.toContain('postgres://');
  });

  it('aceita localhost sem porta (default 5432) e sem senha', () => {
    const parsed = parseLocalDsn('postgresql://erp@localhost/erp');
    expect(parsed).toMatchObject({ host: 'localhost', port: '5432', database: 'erp' });
    expect(parsed.env).toEqual({});
  });

  it('recusa host remoto (regra LOCAL ONLY)', () => {
    for (const host of ['db.example.com', '31.97.159.123', '10.0.0.19']) {
      expect(() => parseLocalDsn(`postgres://u:p@${host}/db`)).toThrow(/não-local/);
    }
  });

  it('recusa protocolo não-postgres', () => {
    expect(() => parseLocalDsn('mysql://u:p@localhost/db')).toThrow(/protocolo/);
  });

  it('recusa DSN malformado e DSN sem database', () => {
    expect(() => parseLocalDsn('nao-e-url')).toThrow(/inválido/);
    expect(() => parseLocalDsn('postgres://u:p@localhost/')).toThrow(/database/);
  });
});

describe('assertRestoreConfirmed', () => {
  it('exige --confirm-restore', () => {
    expect(() => assertRestoreConfirmed(['node', 'restore-local.mjs', LOCAL, 'f.dump']))
      .toThrow(/--confirm-restore/);
    expect(() =>
      assertRestoreConfirmed(['node', 'restore-local.mjs', LOCAL, 'f.dump', '--confirm-restore']),
    ).not.toThrow();
  });
});

describe('args dos binários (spawn sem shell)', () => {
  it('pg_dumpArgs: array plana, sem shell interp, com arquivo de saída', () => {
    const args = pgDumpArgs(parseLocalDsn(LOCAL), '/tmp/erp.dump');
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain('--format');
    expect(args).toContain('custom');
    expect(args.join(' ')).not.toContain('secret'); // senha nunca em argv
  });

  it('pgRestoreArgs: sempre --clean --if-exists', () => {
    const args = pgRestoreArgs(parseLocalDsn(LOCAL), '/tmp/erp.dump');
    expect(args).toContain('--clean');
    expect(args).toContain('--if-exists');
  });
});
