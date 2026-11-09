# RELEASE G2 — Consolidado de evidências

Repo: /media/rafaelejosi/NovoVolume/erp-platform (git local, branch main) · Data: 2026-11-08

## Commits (histórico completo)
af7b2d2 chore: import kit SDD (173 docs, 123 cards, validador PASS)
b23d936 chore: .gitattributes LF
a5e94cd feat(core): tenancy+authorization+audit+outbox+entitlements (TDD GREEN)
2c8328c fix: node_modules fora do índice + .gitignore
e1b44ea test(core): mutation 97.44% (gate ≥95%)
8409e92 test(qa): 11 ataques adversariais bloqueados
bb4c6be test(qa): fix finding de review + REVIEW-G2

## Gates
| Gate | Resultado | Evidência |
|---|---|---|
| QG-100 (vitest v8, perFile) | PASS 100/100/100/100 nos 6 arquivos | evidencias/QA-G2/re-execucao.log |
| Mutation (Stryker break 95) | PASS 97,44% | packages/core/reports/mutation/mutation.html |
| QA adversarial | PASS — 11/11 ataques bloqueados | test/qa-adversarial.test.ts |
| Reviewer independente | APPROVED (1 finding corrigido) | evidencias/REVIEW-G2.md |
| CI real | NOT RUN — requer remote (Ezequias criará repo) |
| Push remote | NOT RUN — decisão: versionamento local |

## Domínios implementados (specs canônicas do kit)
- tenancy.ts — CORE-TENANT-ISOLATION (ctx da sessão, assert, scoped query)
- authorization.ts — matriz role×action×resource×tenant + entitlement server-side
- audit.ts — append-only frozen, redação PII
- outbox.ts — at-least-once + idempotência (IdempotentEffectRunner)
- entitlements.ts — catálogo por tenant, require server-side

## Pendências bloqueantes (humanos)
- ADR-0001 e 12 decisões de DECISIONS_TO_MAKE → PROPOSED, aguardam aprovação
- Repo oficial (Ezequias) → push do histórico local
- Postgres real: integração/E2E na onda G3 (QG-3/4/6)
