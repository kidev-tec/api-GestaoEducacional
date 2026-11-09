# RELEASE G5 — Consolidado (2026-11-08)

- apps/api: Fastify 5 + @fastify/swagger + Scalar API Reference (/docs) — decisão de doc do usuário.
- 7 rotas OpenAPI: health, enrollments CRUD+transition, ledger entries+balance, audit count.
- Idempotência end-to-end via header Idempotency-Key (banco garante com advisory lock + unique).
- 16/16 E2E HTTP real · typecheck clean · adversarial HTTP 100% bloqueado.
- Commits: 4c1823c feat, 5b738e0 docs. Merge → staging-local.
- CI/push NOT RUN (local).
