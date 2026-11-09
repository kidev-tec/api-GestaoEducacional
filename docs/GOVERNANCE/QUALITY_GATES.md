# Quality Gates — critérios de progressão

| Gate | Momento | Evidências obrigatórias | Bloqueia se... |
|---|---|---|---|
| G0 Escopo | antes de pesquisa/alteração | card, autoria, autorização, dependências | sem alvo autorizado, ambiguidade de sistema |
| G1 Design | antes de interfaces/contratos | telas/fluxos, tokens, ADR/RFC quando necessário | arquitetura incerta ou cópia visual |
| G2 Security | antes de merge | authz, tenant isolation, threats, dados sintéticos, review | cross-tenant, segredo, falha crítica |
| G3 Quality | antes de merge | testes pass/fail/not run, revisão independente | testes obrigatórios falham ou não executados sem justificativa |
| G4 Migration | antes de aplicar dados reais | dry-run, reconciliação, backup/restore, plano de rollback | dados sem autorização, perda não analisada |
| G5 Release | antes de prod | runbook, observabilidade, rollout, alertas, aprovação humana | sem rollback/monitoramento/validação |
| G6 Acceptance | antes de DONE | critério do card, evidências e revisão | critério sem prova ou sign-off faltando |

Verificações automáticas não substituem revisão humana nem garantia de segurança. Registrar PASS, FAIL e NOT RUN por item; `NOT RUN` de controle crítico é bloqueio.
