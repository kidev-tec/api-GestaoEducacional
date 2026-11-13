# API — Gestão Educacional (KIDEV Tec)

API REST do sistema de gestão educacional. Multi-tenant, primeiro vertical: Educação.

## Stack

- **Node 22 + TypeScript 5.8** — Fastify 5, Swagger/OpenAPI + Scalar
- **Monorepo npm workspaces** — `apps/api` + `packages/{core, education, infra}`
  - `@erp/core` — domínio (pessoas, matrículas, turmas)
  - `@erp/education` — regras do vertical Educação (mensalidades, entitlements)
  - `@erp/infra` — Postgres, outbox, repositórios, testcontainers
- **Auth**: argon2id
- **Testes**: Vitest — unit + E2E com Postgres real via testcontainers. Cobertura **100/100/100/100** (statements/branches/functions/lines)

## Rodar

```bash
npm install
npm run dev        # apps/api
npm test           # suíte completa (unit + E2E)
```

Requer Docker (testcontainers) e Postgres local para dev.

## Estrutura

```
apps/api/           # servidor Fastify (rotas, auth, worker outbox)
packages/core/      # domínio agnóstico de vertical
packages/education/ # vertical Educação
packages/infra/     # Postgres, outbox, repositórios
```

## CI

`.github/workflows/gates.yml` — typecheck → testes (100×4) → audit DoD. Bloqueia PR fora do padrão.

## Fluxo de branches

`feat/**` → PR → `staging` → PR → `main`

## Ecossistema

| Repo | Papel |
|------|-------|
| `api-GestaoEducacional` | Esta API |
| `site-GestaoEducacional` | Frontend web (React 19 + Vite) |
| `app-GestaoEducacional` | Desktop (Electron, empacota o web) |
