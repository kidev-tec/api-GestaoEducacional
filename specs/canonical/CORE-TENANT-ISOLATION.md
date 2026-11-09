# SPEC CORE-TENANT-ISOLATION — Isolamento de organizações

- Status: **DRAFT (exemplo a aprovar)** · Criticidade P0 · Version 0.1.0
- Owner: arquitet@ + security + PO da escola (a designar)

## Premissas

Todo recurso de negócio é escopado a um tenant do ERP. A autenticação e autorização no backend determinam `tenantId` efetivo; qualquer ID de tenant enviado pelo usuário não pode, por si, autorizar acesso. Jobs e eventos preservam contexto de tenancy com verificação.

## Invariantes

1. Não existe leitura/escrita cross-tenant sem permissão de suporte explicitamente auditada e aprovada.
2. IDs de recurso válidos em outro tenant retornam resposta segura sem expor existência/conteúdo.
3. Filtros de tenant estão no acesso ao dado; em operações críticas, adicionar defesa em profundidade no banco.
4. Caches, arquivos e jobs jamais permitem mistura entre organizações.
5. Auditoria registra ator, ação, contexto e identificador minimizado sem PII em claro.

## Cenários de aceite

```gherkin
Feature: Tenant isolation
  Scenario: Leitura permitida no tenant de origem
    Given um usuário do tenant A com permissão de visualizar matrículas
    And uma matrícula do tenant A
    When solicita a matrícula pelo identificador
    Then a API retorna a matrícula autorizada

  Scenario: Tentativa de IDOR contra tenant B
    Given um usuário somente do tenant A
    And um identificador de matrícula existente no tenant B
    When solicita esse identificador por API
    Then a API não revela dados do tenant B
    And registra um evento de segurança sem dados pessoais

  Scenario: Worker reprocessado
    Given um evento assinado para tenant A
    When o worker reprocessa o evento com o contexto original
    Then só recursos do tenant A podem ser alterados
```

## Testes mínimos

- Unit: policy matrix e escopo efetivo, 100/100/100/100.
- Integration: Postgres com tenants A/B, leituras/escritas/buscas/cache e jobs adversariais.
- E2E: duas sessões com organizações diferentes e IDs trocados.
- Security: fuzz de pares tenant/actor/resource, reporte de acesso negado, restore e exportação.
- Evidências: traces redigidos, logs de teste, relatórios de cobertura por arquivo e commit.

## Aberto

Modelagem tenancy (coluna tenant_id, schema ou DB por tenant), suporte multisede, delegação para contabilidade, políticas de exportação: ADR e validação necessárias.
