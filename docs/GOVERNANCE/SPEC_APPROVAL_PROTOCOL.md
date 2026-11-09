# Spec approval protocol — promoção DRAFT → APPROVED

Uma spec não é promovida apenas porque um agente escreveu um arquivo. Exigir revisão de produto + reviewer técnico; segurança como aprovador adicional para identidade, tenancy, finanças e PII.

## Metadados

```md
- **Status:** APPROVED
- **Approver:** nome/role humano identificável
- **Approval evidence:** link para PR/review/decisão
- **Approved version:** v0.x.y
- **Approved at:** YYYY-MM-DD
```

Revisão independente verifica contradições com ADRs, casos negativos, complexidade, privacidade, testes e migrações. Qualquer alteração de regra após aprovação exige re-review e revisão de impacto no E2E/contratos.

## O validador documental

Permite `DRAFT`, `IN_REVIEW`, `APPROVED`, `IMPLEMENTING`, `VERIFYING`, `ACCEPTED`, `SUPERSEDED`. Para APPROVED e estados posteriores exige `Approver`, `Approval evidence` e `Approved version`. Não confirma que a pessoa aprovou de fato: isso deve estar vinculado ao sistema de PR/proteção de branch.
