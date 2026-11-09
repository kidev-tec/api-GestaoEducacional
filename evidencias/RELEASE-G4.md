# RELEASE G4 — Consolidado (2026-11-08)

- packages/infra: testcontainers Postgres 16, migration idempotente 001_init.sql, repositórios tenant-scoped com advisory lock.
- 12/12 integração real · migration 2× OK · concorrência 10→1 · rollback · cross-tenant sem oracle · CHECK constraints.
- Commits: 02bdcf1 (feat), 7516b60 (docs). Branch feat/g4-integration → merge staging-local.
- CI/push: NOT RUN (versionamento local).
- Próxima onda (G5): API HTTP + OpenAPI + contracts + Orval — requer decisão de framework (ADR PROPOSED: Fastify recomendado).
