# G8 — Evidências da release v0.1.0 (2026-11-09)

## Entregáveis (apps/desktop/release/, SHA-256 em release-manifest.json)
- ERP Platform-0.1.0.AppImage — Linux portátil, 120,0 MB (08eff5b619c5306e…)
- erp-desktop_0.1.0_amd64.deb — Debian/Ubuntu/Mint, 96,5 MB (5c29b365f4bb0675…)
- ERP-Platform-Setup-0.1.0.exe — Windows NSIS via wine, 115,7 MB (df0fd3fdb3c5e5be…)
  (sem certificado de código — assinatura pulada, esperado)

## DMG macOS — NÃO gerado (limitação técnica real)
electron-builder exige sips/hdiutil (exclusivos macOS). Tentativa real falhou
com "sips process failed ENOENT" mesmo com ícone 512 corrigido. Config dmg
universal (x64+arm64) pronta no repo; build num Mac: npx electron-builder --mac dmg.

## RF-023: metadata deb válida (dpkg-deb -I) — verify-release PASSOU
## RF-024: release-manifest.json com bytes+SHA-256 (3 artefatos)
## RF-025: CHANGELOG.md (Keep a Changelog) + evidencias/G8/RELEASE-NOTES-v0.1.0.md
## RF-026: scripts/verify-release.mjs + testes 3/3
- PASSA com manifest íntegro; FALHA com SHA-256 adulterado; FALHA sem manifest
## RF-027: smoke final do pacote REAL
- linux-unpacked/erp-desktop aberto em Xvfb :100 (janela "ERP Platform" 1279x799)
- screenshot evidencias/G8/smoke-desktop-v0.1.0.png verificado por visão:
  banner G7 "Modo Desenvolvimento local · localhost:3000", header, tabs teal,
  form matrícula, tenant selector, empty state — UI COMPLETA com tokens.

## Regressões finais
- api 56/56 (inclui verify-release.test 3/3 + backup guards)
- web 35/35 · desktop 12/12

## Comandos
- node scripts/release-manifest.mjs (gera manifest)
- node scripts/verify-release.mjs (valida, EXIT 1 em divergência)

## Release final
- staging-local 626e129 → main 1107eb4 → tag anotada v0.1.0. Push NOT RUN (regra).
- Loop G2..G8 ENCERRADO em 2026-11-09.
