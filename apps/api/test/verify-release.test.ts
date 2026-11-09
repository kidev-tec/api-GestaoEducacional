/**
 * G8 (RF-026) — verify-release: teste com artefato fake adulterado.
 * NÃO toca no release real: monta um diretório temp com manifest+binário.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/verify-release.mjs');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verifyrel-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeRelease(shaOf) {
  const content = Buffer.from('fake-artifact-content-1234567890');
  const artifactPath = join(dir, 'ERP Platform-0.1.0.AppImage');
  writeFileSync(artifactPath, content, { mode: 0o755 });
  writeFileSync(
    join(dir, 'release-manifest.json'),
    JSON.stringify({
      version: '0.1.0',
      artifacts: [{
        name: 'ERP Platform-0.1.0.AppImage',
        bytes: content.length,
        sha256: createHash('sha256').update(shaOf === 'bad' ? Buffer.from('TAMPERED') : content).digest('hex'),
      }],
    }),
  );
}

function run() {
  // roda o script com release dir "recolocado" via env de teste? — o script
  // resolve por import.meta.url; para testar sem tocar o release real,
  // copiamos o script para o temp já que ele usa caminho relativo a si.
  const scriptCopy = join(dir, 'verify-release-copy.mjs');
  const src = readScript().replace(
    /const RELEASE_DIR = .*;/,
    `const RELEASE_DIR = ${JSON.stringify(dir + '/')};`,
  );
  writeFileSync(scriptCopy, src);
  return execFileSync('node', [scriptCopy], { encoding: 'utf8' });
}

function runExpectFail() {
  const scriptCopy = join(dir, 'verify-release-copy.mjs');
  const src = readScript().replace(
    /const RELEASE_DIR = .*;/,
    `const RELEASE_DIR = ${JSON.stringify(dir + '/')};`,
  );
  writeFileSync(scriptCopy, src);
  try {
    execFileSync('node', [scriptCopy], { encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (e) {
    return e;
  }
}

import { readFileSync as rs } from 'node:fs';
function readScript() {
  return rs(SCRIPT, 'utf8');
}

describe('verify-release.mjs (RF-026)', () => {
  it('PASSA com manifest íntegro (hash e tamanho corretos)', () => {
    fakeRelease('good');
    const out = run();
    expect(out).toContain('PASSOU (1 artefatos');
  });

  it('FALHA com hash adulterado', () => {
    fakeRelease('bad');
    const e = runExpectFail();
    expect(e).toBeTruthy();
    expect(String(e.stderr)).toContain('SHA-256 divergiu');
  });

  it('FALHA sem manifest', () => {
    const e = (() => {
      try {
        const scriptCopy = join(dir, 'v.mjs');
        const src = readScript().replace(
          /const RELEASE_DIR = .*;/,
          `const RELEASE_DIR = ${JSON.stringify(dir + '/')};`,
        );
        writeFileSync(scriptCopy, src);
        execFileSync('node', [scriptCopy], { encoding: 'utf8', stdio: 'pipe' });
        return null;
      } catch (err) {
        return err;
      }
    })();
    expect(e).toBeTruthy();
    expect(String(e.stderr)).toContain('release-manifest.json ausente');
  });
});
