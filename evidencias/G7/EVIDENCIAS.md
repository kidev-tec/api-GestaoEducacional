# G7 — Evidências (2026-11-09)

Branch: `feat/g7-hardening` (base staging-local 76b370d). SPEC v1.2 congelada.

## Gates (executados nesta máquina)
- API: `npx tsc --noEmit` limpo; `vitest run --coverage`: **43/43**, app.ts + obs.ts **100×4** (server.ts excluído com justificativa: bootstrap só).
- Web: tsc limpo; `vitest run --coverage`: **35/35**, 100×4 (inclui useApiStatus.ts e DevBanner).
- Desktop (regressão): **12/12**.
- `vite build`: EXIT 0 (1.77s).

## RF-018 — request-id + logs seguros
- `apps/api/src/obs.ts`: `resolveRequestId` (aceita só UUID; caso contrário gera — nunca ecoa input), `safeLogLine` (allowlist requestId/tenantId/method/route/status/durationMs; route truncada em 120; tenant vazio omitido).
- Hook `onRequest` seta `x-request-id` na resposta; hook `onResponse` emite 1 linha JSON por request via `logSink` injetável.
- **Prova runtime real**: `curl -H 'x-request-id: f47ac10b-...'` → ecoa; `curl -H 'x-request-id: inject-me'` → `x-request-id: 994790eb-ee21-4c00-8a93-3571b7189224` (gerado, não ecoado).

## RF-019 — /ready
- `/ready` público (fora do tenant guard), faz `SELECT 1` no pool; 200 `{"status":"ready"}` ou 503 `{"status":"unavailable","error":"database unavailable"}` — sem stack/DSN.
- **Prova adversarial real** (container erp-dev-pg na 55432): DB up → 200 ready; `docker stop` → **HTTP 503** com body limpo; `docker start` → 200 ready de novo, sem restart da API.
- Regressão: dados do E2E G6a preservados (tenant A: balanceCents 15000, audit 3).

## RF-020 — banner Modo Dev + diagnóstico offline (web)
- `DevBanner` + `useApiStatus`: online → `role=status` "Modo Desenvolvimento local · endpoint http://localhost:3000"; offline → `role=alert` com diagnóstico humano (endpoint, banco local) + botão "Tentar de novo"; re-check automático a cada 30s.
- **Prova E2E real** (Chrome + Vite 5173 + API 3000): 3 estados capturados:
  - `banner-online.png` (status teal)
  - `banner-offline.png` (alert dourado, API derrubada de verdade)
  - `banner-recuperado.png` (após clique em "Tentar de novo" com API re-erguida — sem reload)

## RF-021 — backup/restore local-only
- `scripts/backup-local.mjs` + `scripts/restore-local.mjs` (mesma biblioteca, modos distintos): `parseLocalDsn` aceita apenas localhost/127.0.0.1/::1; senha nunca em argv (vai por `PGPASSWORD` no env); restore exige `--confirm-restore`; `pg_dump`/`pg_restore` via `spawnSync` SEM shell.
- Testes: `apps/api/test/backup-guards.test.ts` — 8/8 (host remoto recusado, protocolo errado, DSN malformado, confirmação obrigatória, args sem senha).
- **Prova real**: backup via `pg_dump` do container → `/tmp/erp-g7.dump` (13 KB, 36 TOC entries); guard remoto recusou `31.97.159.123` com exit 1 no host.
- Nota: `pg_dump` não existe no PATH do host; o script detecta e falha com mensagem humana ("instale o cliente PostgreSQL").

## RF-022 — a11y preservada
- Banner usa landmarks/roles nativos (status/alert); snapshot a11y do Chrome confirmou árvore íntegra em ambos os estados.

## Commits
- feat(api): request-id + safe logs + /ready (RF-018/019)
- feat(web): DevBanner modo dev + diagnóstico offline (RF-020)
- feat(scripts): backup/restore local-only (RF-021)
- test: gates 100×4 (api 43, web 35, desktop 12)

## Review independente r1 (cx/gpt-5.6-terra, deleg_1dedc6bc) → rework
Verdict: CHANGES com 2 findings — ambos corrigidos neste commit:
1. HIGH (backup-local.mjs): spawnSync herdava process.env → PGHOST/PGSERVICE/
   PGPASSFILE poderiam redirecionar libpq. Fix: buildToolEnv com allowlist
   (PATH/HOME/LANG/LC_ALL/TMPDIR) + PGPASSWORD próprio; teste prova que
   PGHOST=attacker.example.com não vaza no env do tool.
2. MEDIUM (obs.ts): tenant não validado ia pro log verbatim. Fix: regex
   canônica [A-Za-z0-9][A-Za-z0-9_-]{0,63}; não-canônico → "[redacted]".
   Teste cobre SQL injection, newline, <script>, overflow.
Gates pós-rework: API 53/53 (100×4), tsc clean.

## Re-review r2 (deleg_5f01fea0, cx/gpt-5.6-terra): APPROVED
- buildToolEnv allowlist confirmada; spawnSync usa buildToolEnv; sem spread de process.env.
- tenantId canônico com [redacted] confirmado.
- Re-execução independente: 53/53, 100×4 (app.ts + obs.ts).
