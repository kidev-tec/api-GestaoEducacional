# Toolchain sugerida e critérios de adoção

| Área | Ferramenta proposta | Decisão |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | proposta, ADR pendente |
| Web | React + TypeScript + Vite ou Next.js | alternativa ainda não congelada |
| API | Node.js + TypeScript + Fastify | proposta coerente com experiência existente |
| Database | PostgreSQL + migrações verificadas | proposta |
| Contracts | OpenAPI 3.1 + validador | recomendação |
| Client generation | Orval + TanStack Query + MSW | recomendação para apps React |
| UI library | componentes próprios/headless + Storybook | recomendação |
| Tests | Vitest + Playwright + Testcontainers | recomendação |
| QA security | SAST, secret scanning, dependency and container scanning | ferramentas a escolher |
| Observability | OpenTelemetry + logs/traces métricas | avaliar custo e hosting |

Primeiro fechar ADR do stack. Não instalar tudo simultaneamente só para cumprir checklist; cada ferramenta precisa de owner, propósito, manutenção e prova de valor. Código gerado por Orval é artefato derivado do contrato e não pode ser editado manualmente.
