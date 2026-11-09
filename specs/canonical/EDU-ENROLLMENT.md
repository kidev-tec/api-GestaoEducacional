# SPEC EDU-ENROLLMENT — Matrícula escolar

- Status **DRAFT** · Criticidade P0 · Primeiro vertical: educação
- Objetivo: matrícula confiável, observável, autorizada e sem duplicidade acidental.

## Invariantes

1. Matrícula pertence à escola/unidade e referência um aluno e uma oferta educacional válida.
2. Não duplicar matrícula ativa para mesmo aluno + turma/oferta quando a regra de negócio proibir.
3. Mudança de estado exige permissão, pré-condições e trilha de auditoria.
4. Contrato financeiro e boleto/cobrança são processos relacionados, não efeito colateral sem controle transacional.
5. Reenvio com mesma idempotency key e payload compatível deve devolver o resultado anterior; payload distinto com mesma chave deve ser tratado como conflito conforme ADR.

## Estados propostos

`DRAFT → PENDING_DOCUMENTS → PENDING_APPROVAL → ACTIVE → COMPLETED`; `CANCELED` e `REJECTED` por transições explícitas. Estados e gatilhos devem ser validados com a escola (não são comportamento observado do Hermes/F10).

## Gherkin

```gherkin
Feature: Matrícula
  Scenario: Matrícula válida no tenant autorizado
    Given um aluno e uma oferta sintéticos pertencentes ao tenant A
    And um operador com permissão de matrícula na unidade
    When realiza a matrícula com idempotency key nova
    Then é criada uma única matrícula auditável
    And a resposta informa o estado inicial

  Scenario: Repetição de requisição
    Given uma matrícula criada com a chave K
    When a mesma requisição é repetida com a chave K
    Then não é criada segunda matrícula

  Scenario: Referência cruzada
    Given um aluno no tenant B e um operador do tenant A
    When tenta matricular o aluno B em turma do tenant A
    Then a API nega e não revela dados privados
```

## Testes obrigatórios

Unit state machine e autorização 100/100/100/100; property de idempotência e transições; integration Postgres com concorrência e rollback; contract OpenAPI status/erros; E2E operador; a11y de formulários e visual states; segurança cross-tenant. Verificar fluxo da escola e exigências regulatórias antes de aprovar.
