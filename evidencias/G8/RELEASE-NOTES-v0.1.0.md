# ERP Platform v0.1.0 — Release Notes (2026-11-09)

Primeira release com entregável desktop instalável. ERP SaaS multi-tenant
(vertical educação), 100% local — nenhum push, nenhum dado real.

## Instaladores

| Artefato | Plataforma | Tamanho | SHA-256 (prefixo) |
|---|---|---|---|
| `ERP Platform-0.1.0.AppImage` | Linux (portátil) | 120,0 MB | `08eff5b619c5306e…` |
| `erp-desktop_0.1.0_amd64.deb` | Debian/Ubuntu/Mint | 96,5 MB | `5c29b365f4bb0675…` |
| `ERP-Platform-Setup-0.1.0.exe` | Windows 10/11 | 115,7 MB | `df0fd3fdb3c5e5be…` |

Manifesto completo: `apps/desktop/release/release-manifest.json`.
Verificação: `node scripts/verify-release.mjs` (confere SHA-256, tamanho,
metadata deb, permissão de execução — sem internet).

### DMG macOS — NÃO gerado nesta release
Build de DMG exige ferramentas exclusivas do macOS (`sips`/`hdiutil`).
Config pronta no repo (`electron-builder.config.js`, target dmg universal
x64+arm64, ícone 512). Para gerar num Mac:
```
cd apps/desktop && npm ci && npm run build && npx electron-builder --mac dmg
```
Alternativa sem Mac próprio: GitHub Actions com runner `macos-latest`
(um push num repo oficial será suficiente — pendente Ezequias).

## Instalação

**Linux (deb):**
```
sudo dpkg -i erp-desktop_0.1.0_amd64.deb
# remover: sudo apt remove erp-desktop
```
Dependências: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6.

**Linux (AppImage):**
```
chmod +x "ERP Platform-0.1.0.AppImage"
./"ERP Platform-0.1.0.AppImage"
```

**Windows:** executar `ERP-Platform-Setup-0.1.0.exe` (instalador NSIS,
permite escolher diretório). Não assinado — o Windows SmartScreen pode
exibir aviso; é o comportamento esperado sem certificado de código.

## Requisitos para usar (modo desenvolvimento local)

O app é um cliente: precisa da API + Postgres rodando localmente.

1. Docker com Postgres: `docker run -d --name erp-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=erp -p 55432:5432 postgres:16-alpine`
2. Migration: `psql` do container aplica `packages/infra/migrations/001_init.sql` + tenants A/B.
3. API: `cd apps/api && DATABASE_URL="postgres://postgres:dev@127.0.0.1:55432/erp" npx tsx src/server.ts`
4. Abrir o desktop app — banner "Modo Desenvolvimento local" confirma conexão; se a API cair, diagnóstico humano + botão "Tentar de novo".

Backup: `node scripts/backup-local.mjs "postgres://postgres:dev@localhost:55432/erp" backup.dump`
Restore: `node scripts/restore-local.mjs "postgres://postgres:dev@localhost:55432/erp" backup.dump --confirm-restore`

## Escopo entregue (G2..G7)

- **Core**: multi-tenancy isolado, audit append-only, outbox idempotente, entitlements.
- **Educação**: matrícula com state machine e idempotência; ledger em centavos inteiros append-only com reversão vinculada.
- **API**: Fastify + OpenAPI + Scalar `/docs`, CORS restrito, `/health` + `/ready` (probe real do Postgres), request-id, logs JSON sem PII.
- **Web**: matrículas/ledger/auditoria com tokens Brand Book, client gerado do OpenAPI, tenant selector.
- **Desktop**: Electron com contextIsolation/sandbox, entrega AppImage/deb/exe.
- **Qualidade**: ~120 testes ativos, coverage 100×4 nos módulos novos, mutation ≥95% nos domínios críticos, review independente cross-model em todas as fases (6 findings corrigidos).

## Limitações conhecidas (honestidade de release)

- **Sem autenticação real**: modo desenvolvimento local com seleção manual de tenant (A/B de teste). JWT/OIDC é ADR PROPOSED — decisão humana pendente.
- **Sem assinatura de código**: exe/AppImage não assinados.
- **DMG macOS**: não gerável no Linux (ver acima).
- **Dados**: nenhum dado real; banco de dev com tenants sintéticos A/B.
- **Repo**: 100% local; histórico completo aguarda repo oficial (Ezequias).
- **Backup/restore**: recusam qualquer host fora de localhost — por design.
