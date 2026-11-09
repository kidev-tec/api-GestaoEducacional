# Test strategy — pirâmide + sistemas reais

| Camada | Escopo | Ferramentas sugeridas | Gate |
|---|---|---|---|
| Unidade/TDD | invariantes, regras, RBAC/ABAC, ledger, matrícula | Vitest, fast-check | 100/100/100/100 domínio crítico |
| Integração | Postgres, constraints, transação, workers, outbox | Vitest + Testcontainers, containers efêmeros | zero erros, isolamento por teste |
| Contratos API | schema, status, auth e compatibilidade | OpenAPI + Orval + schema diff e validação | sem breaking change imprevista |
| Componentes | estados, teclado, resposta, formulários | Storybook + Vitest addon, Testing Library | histórias e play tests por estado crítico |
| Visual | regressão por tema, role e viewport | Playwright snapshots ou Chromatic | alteração explicada e aprovada |
| E2E | entrada → ato de negócio → persistência → eventos | Playwright + API real + Postgres sintético | 100% journeys P0 passam |
| Segurança | cross-tenant, IDOR, injection, replay, authz | testes programáticos + auditoria humana | nenhum HIGH/CRITICAL aberto |
| Resiliência | retries, fila, falha API terceira, concorrência | fixtures, fault injection | recuperação e idempotência demonstradas |
| Performance | latência e capacidade com observabilidade | k6 ou similar depois do baseline | SLO aprovado/medido |

## Antes de implementar

Enumerar casos que falham para: sucesso, estado inválido, permissão, cross-tenant, concorrência, rollback, cancelamento, timeout, evento duplicado, payload inválido e replay. Se não se aplicar, justificar.

## Dados de teste

Testes só usam usuários e escolas sintéticos, tenant A / tenant B, IDs independentes, documentos falsos, datas fixas, relógios controlados. Sem transação real, meios de pagamento ativos ou e-mails externos nos pipelines.

## Anti-regressão

1. Bug relatado vira teste que falha antes de corrigir (RED).
2. PR vincula case ID, spec e componente/endpoint.
3. Cada fix executa suite local, integração relevante e smoke E2E.
4. Nightly completo em múltiplos browsers e escopo multitenant.
5. Alterações de API acionam client generation + diff e testes consumer.
6. Alterações UI acionam stories atualizadas e visual comparison.
7. Cada flaky recebe issue e root-cause; não silenciar nem aceitar green por sorte.

## Evidence policy

Reportar comando exato, ambiente, commit SHA, data, quantidade de testes, resultado, screenshot/trace redigidos e link do CI. `PASS` depende de output real, não da confiança do agente. Ver `templates/TEST_EVIDENCE_TEMPLATE.md`.
