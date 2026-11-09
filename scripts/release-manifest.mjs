/**
 * G8 (RF-024) — Gera apps/desktop/release/release-manifest.json com
 * nome, bytes e SHA-256 de cada artefato. Uso:
 *   node scripts/release-manifest.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_DIR = new URL('../apps/desktop/release/', import.meta.url).pathname;
const ARTIFACT_EXTS = ['.AppImage', '.deb', '.exe', '.dmg', '.snap', '.rpm'];
const EXCLUDE = ['release-manifest.json', 'builder-debug.yml', 'builder-effective-config.yaml'];

function sha256(file) {
  return createHash('sha256').update(statSync(file) ? readAll(file) : '').digest('hex');
}

import { readFileSync } from 'node:fs';
function readAll(file) {
  return readFileSync(file);
}

const entries = [];
for (const name of readdirSync(RELEASE_DIR)) {
  if (EXCLUDE.includes(name)) continue;
  if (!ARTIFACT_EXTS.some((ext) => name.endsWith(ext))) continue;
  const full = join(RELEASE_DIR, name);
  const st = statSync(full);
  entries.push({
    name,
    bytes: st.size,
    sha256: createHash('sha256').update(readAll(full)).digest('hex'),
  });
}

if (entries.length === 0) {
  console.error('ERRO: nenhum artefato em', RELEASE_DIR);
  process.exit(1);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  version: '0.1.0',
  artifacts: entries.sort((a, b) => a.name.localeCompare(b.name)),
};

writeFileSync(join(RELEASE_DIR, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${entries.length} artefato(s)`);
for (const e of manifest.artifacts) {
  console.log(`  ${e.name}  ${(e.bytes / 1024 / 1024).toFixed(1)} MB  sha256=${e.sha256.slice(0, 16)}…`);
}
