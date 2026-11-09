# SPEC CORE-MODULE-ENTITLEMENTS — Habilitação de módulos SaaS

- Status **DRAFT (exemplo)** · P0 · v0.1
- Distinção: licenciamento do ERP não é a mensalidade paga pelo aluno.

## Invariantes

1. Capability desabilitada não executa escrita por API, batch ou UI (deny-by-default no serviço).
2. Mudança de assinatura não apaga dados, auditorias ou obrigações legais.
3. Todo acesso é associado a tenant, módulo, capability, vigência e sujeito autenticado.
4. Assinatura e catálogos versionados são auditáveis, incl. retry/replay.
5. Grace period e read-only são decisões comerciais explícitas, não defaults acidentais.

## Cenários

```gherkin
Feature: Module entitlements
  Scenario: Tenant ativa módulo de matrícula
    Given um tenant com entitlement edu.enrollment.write válido
    When uma pessoa autorizada cria matrícula válida
    Then o módulo aceita o comando

  Scenario: Tenant tenta escrever sem entitlement
    Given um tenant sem entitlement edu.enrollment.write
    When requisita criação de matrícula por API
    Then o backend rejeita o comando com erro padronizado
    And não modifica dados

  Scenario: Plano é reduzido
    Given registros de matrícula existentes
    When o módulo fica inativo conforme contrato comercial
    Then os registros históricos não são apagados
    And operações passam a obedecer a política de leitura pós-suspensão
```

## Testes

Unit 100/100/100/100 sobre policy evaluators; integration para tenant A/B e refresh da licença; contract para erro de entitlement; E2E de módulos habilitados/desabilitados. Requer ADR para política pós-suspensão.
