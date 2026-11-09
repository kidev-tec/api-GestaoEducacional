# Gates enterprise e contrato 100 / 100 / 100 / 100 (QG-100)

## Significado

Quatro métricas para **domínio crítico** (no mínimo core IAM, autorização, tenant isolation, finanças, matrícula, licenciamento):

| Threshold | Alvo | Aplicação |
|---|---|---|
| Statements | 100% | por arquivo de código de negócio crítico |
| Branches | 100% | cada decisão coberta; validar casos negativos |
| Functions | 100% | todas as funções exercitadas |
| Lines | 100% | todas as linhas executáveis exercitadas |

Cobertura será medida em Vitest com `all`/`include` e `perFile`, não só nos arquivos importados pelos testes. Não excluir código difícil de cobrir, não adicionar `istanbul ignore` sem RFC aprovada, não manipular cobertura com testes sem assert. Generated code, declarações de tipos, arquivos puramente de tooling e mocks podem ser excluídos por política escrita; a exclusão deve ser listada e revisada.

**Esse objetivo mede execução instrumentada, não garantia de ausência de defeitos.**

## Gates progressivos

- **QG0 (descoberta):** escopo e autorização legal do REA, evidência classificada, sem PII real.
- **QG1 (design):** spec APPROVED, ADR se necessário, contrato e plano de teste assinado.
- **QG2 (TDD):** RED demonstrado, GREEN com checks, REFACTOR, 100/100/100/100 nos domínios listados; typecheck/lint sem erros.
- **QG3 (integração):** Postgres de teste isolado, constraints, transações, retries, concorrência, tenant crossing e idempotência validados.
- **QG4 (contratos):** OpenAPI validado; diff breaking reprovado; Orval regenerado sem diff não commitado; contrato consumidor testado.
- **QG5 (UI):** Storybook cobre variantes/estados; testes de interação e a11y; visual regressions revisadas; no console errors.
- **QG6 (E2E):** 100% dos cenários **P0 definidos na matriz** automatizados e passando em CI; navegadores alvo e fluxos de acessibilidade.
- **QG7 (segurança):** zero findings não tratados de severidade CRITICAL/HIGH (categorias e política de false positive documentadas), secret scan e permissões de produção revisadas.
- **QG8 (release):** performance de fluxos críticos aferida com baseline, backup/restore e rollout/rollback aprovados, observabilidade verificada, aprovação humana.

## Outros objetivos

- Mutation score recomendado ≥95% nos módulos críticos, revisando mutantes sobreviventes. Meta é gate após piloto dos primeiros módulos — não bloquear bootstrap impossível de avaliar.
- Property-based/fuzz para regras monetárias, IDs/serialização, authz e isolamento de tenants.
- 100% de journeys P0 E2E significa **todos os cenários conhecidos classificados P0**; não equivale a todas as combinações possíveis.
- A11y: WCAG 2.2 AA para fluxos críticos, com ferramentas e revisão humana; `axe` sem violações detectadas não prova conformidade total.
- E2E: testes de regressão, smoke e nightly completos, sem flaky conhecido não mitigado. Retries não podem mascarar falha crônica.
- SLO e tempos de resposta definidos com medições do ambiente real, não porcentagens inventadas de Lighthouse.

## Política de exceções

Se 100% revelar complexidade imprópria, não diminuir silenciosamente. Criar RFC com segmento de código exato, inviabilidade técnica demonstrada, controles compensatórios, impacto e aprovação humana, prazo e issue de remoção. Priorizar código testável e coeso em vez de inflar testes artificiais.

## Bloqueios automáticos

Um check `NOT RUN`, `SKIPPED` sem justificativa ou `UNKNOWN` **nunca** satisfaz `PASS`. Merge protegido e deploy de produção não devem depender só do julgamento do agente autor.
