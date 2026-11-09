/**
 * G8 (RF-026) — Verifica o release local SEM internet:
 * 1. cada artefato do manifesto existe e o SHA-256 bate;
 * 2. deb metadata válida (dpkg-deb -I, se disponível);
 * 3. AppImage é executável.
 * Uso: node scripts/verify-release.mjs   → EXIT 0 ok / 1 divergência.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const RELEASE_DIR = new URL('../apps/desktop/release/', import.meta.url).pathname;
const MANIFEST = join(RELEASE_DIR, 'release-manifest.json');

function fail(msg) {
  console.error(`FALHOU: ${msg}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) fail('release-manifest.json ausente — rode scripts/release-manifest.mjs primeiro');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!manifest.artifacts?.length) fail('manifesto sem artefatos');

let checked = 0;
for (const art of manifest.artifacts) {
  const full = join(RELEASE_DIR, art.name);
  if (!existsSync(full)) fail(`${art.name}: arquivo ausente`);
  const st = statSync(full);
  if (st.size !== art.bytes) fail(`${art.name}: tamanho ${st.size} ≠ manifesto ${art.bytes}`);
  const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
  if (hash !== art.sha256) fail(`${art.name}: SHA-256 divergiu (esperado ${art.sha256.slice(0, 16)}…, obtido ${hash.slice(0, 16)}…)`);
  console.log(`ok: ${art.name} (${(art.bytes / 1024 / 1024).toFixed(1)} MB, sha ✓)`);
  checked++;
}

for (const art of manifest.artifacts) {
  const full = join(RELEASE_DIR, art.name);
  if (art.name.endsWith('.deb')) {
    try {
      const meta = execFileSync('dpkg-deb', ['-I', full], { encoding: 'utf8' });
      if (!meta.includes('Package:') || !meta.includes('Version:')) fail(`${art.name}: deb sem Package/Version`);
      console.log(`ok: ${art.name} metadata deb válida`);
    } catch {
      console.log('aviso: dpkg-deb indisponível — metadata deb não verificada');
    }
  }
  if (art.name.endsWith('.AppImage')) {
    if (!(statSync(full).mode & 0o111)) fail(`${art.name}: AppImage não executável`);
    console.log(`ok: ${art.name} executável`);
  }
}

console.log(`\nverify-release: PASSOU (${checked} artefatos verificados)`);
