# Review G4 (2026-11-08)

| Item | Resultado |
|---|---|
| Migrations expand→migrate→contract idempotentes (2× sem erro) | PASS |
| UNIQUE (tenant_id, idempotency_key) no banco (defesa final de concorrência) | PASS |
| pg_advisory_xact_lock serializa corrida antes do SELECT | PASS — 10 paralelas → 1 lançamento |
| Repositórios escopados por tenant em TODA query (get/post/transition/balance) | PASS |
| Rollback transacional com audit não-persistido em falha | PASS |
| CHECK constraint de estado no banco (defesa além da app) | PASS |
| Zero DSN de produção; Postgres efêmero testcontainers | PASS (regra do user: testes nunca batem em produção/API) |
| Conventional Commits | PASS |

Observação de review: adversarial lock usa hash sha256 → 63 bits; colisão teórica de lock entre keys distintas é possível mas inofensiva (só serializa a mais, nunca dedupe errado — o índice unique é a fonte de verdade). Documentado, sem ação.

## Veredicto: APROVADO
