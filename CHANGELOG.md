# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento local (SemVer) até repo oficial — nenhum push.

## [0.1.0] — 2026-11-09

Primeira release fechada do ERP Platform (vertical educação). Entregável
desktop instalável + API + web, 100% versionamento local.

### Added — Core (G2)
- Multi-tenancy com isolamento estrito (RF-001/002): tenant no contexto de
  sessão, autorização server-side, cross-tenant bloqueado sem oracle.
- Audit log append-only com redação de PII (RF-003).
- Outbox transacional com idempotência por eventId (RF-004).
- Entitlements no serviço (RF-002). 50 testes, mutation 97,44%.

### Added — Education (G3)
- Matrícula com state machine DRAFT→…→COMPLETED, transições explícitas (RF-005).
- Idempotência por key; payload divergente → CONFLICT (RF-006).
- Ledger financeiro em centavos inteiros, append-only, reversão vinculada
  não-cadeável (RF-007..009); propriedade de conservação de saldo (RF-010).
  54 testes, mutation 95,21%.

### Added — Infra (G4)
- Postgres real via Docker: migrations idempotentes, constraints, advisory
  locks para corrida de idempotência (10 paralelas → 1 lançamento). 12/12.

### Added — API HTTP (G5)
- Fastify 5 + OpenAPI por rota + Scalar em `/docs`; CORS restrito por padrão
  (`localhost:5173`); erros de domínio → HTTP sem vazar stack; idempotência
  end-to-end. 16→20 testes (CORS incluído).

### Added — Web shell (G6a)
- Vite + React + TS consumindo exclusivamente client gerado do OpenAPI.
- Telas Matrículas/Ledger/Auditoria com estados loading/vazio/erro/sucesso.
- Tokens Brand Book (`@erp/tokens`); tenant selector persistido.
- Parser estrito `parseReaisToCents` (centavos fracionários proibidos).
- 32/32 testes, coverage 100×4. E2E de tela com isolamento A/B provado.

### Added — Desktop (G6b)
- Electron com segurança dura: `contextIsolation`, `sandbox`,
  `nodeIntegration: false`, preload mínimo sem IPC/FS, navegação restrita a
  locais, links externos no browser do sistema.
- Smoke E2E real em Xvfb com UI completa renderizada.

### Added — Hardening operável (G7)
- `/ready` com probe real do Postgres (200/503 sem stack — provado com
  docker stop/start).
- `x-request-id` (UUID estrito aceito; inválido gerado — nunca ecoado) +
  logs JSON com allowlist de campos; tenant não-canônico vira `[redacted]`.
- Banner "Modo Desenvolvimento local" + diagnóstico offline humano com retry
  (provo E2E: offline → clique → recuperação sem reload).
- `scripts/backup-local.mjs` / `restore-local.mjs`: DSN apenas localhost,
  `--confirm-restore` obrigatório, spawn sem shell, ambiente com allowlist
  (PGHOST/PGSERVICE/PGPASSFILE nunca herdados).
- API 53/53 (100×4), web 35/35 (100×4), desktop 12/12 (100×4).

### Changed
- `apps/web` Vite `base: './'` (renderização correta em `file://` no Electron).

### Security
- Review independente cross-model em todas as fases (G5..G7): 6 findings
  (2 HIGH, 4 MEDIUM) todos corrigidos e re-verificados.
- Assinatura de código: não configurada (MVP; requer decisão humana).

### Pendente (decisão humana)
- JWT/OIDC real e RBAC por usuário (ADR PROPOSED).
- Repo oficial remoto (Ezequias) — todo o histórico está local.
- Assinatura de código para instaladores; DMG macOS (build exige macOS).
