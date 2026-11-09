# SPEC FINANCE-IDEMPOTENCY — Integridade e repetição segura de lançamentos

- Status **DRAFT** · P0 · Arquitetura financeira exige responsável humano.

## Invariantes

1. Dinheiro em centavos inteiros ou tipo decimal exato; jamais `number` flutuante para somas monetárias de ledger.
2. Operações de contabilização/auditoria são append-only ou têm reversão compensatória; não apagar rastro.
3. Mesma idempotency key não cria segundo lançamento com mesmos atributos.
4. Webhooks não são prova suficiente de liquidação até verificação apropriada no provedor e conciliação.
5. Todas as mudanças que afetam saldo são transacionais, autorizadas e vinculadas ao tenant.
6. Reversão explicita o vínculo ao lançamento original, sem números negativos arbitrários sem modelagem.

## Gherkin

```gherkin
Feature: Idempotência financeira
  Scenario: Webhook duplicado
    Given um pagamento simulado conciliado uma vez no tenant A
    When o mesmo evento é entregue novamente
    Then saldo e lançamentos não sofrem nova alteração

  Scenario: Conflito de chave
    Given um comando de cobrança processado com chave K
    When o emissor repete K com parâmetros diferentes
    Then o comando é rejeitado como conflito e auditado

  Scenario: Falha parcial
    Given um job de cobrança com transação não concluída
    When ocorre retry após falha do worker
    Then não há duplicidade nem registro financeiro órfão
```

## Testes mínimos

100/100/100/100 nas regras; property para conservação de saldo e reversão; integração para unique index/transações/retry/concorrência; E2E com pagamentos **simulados**, não dados financeiros reais. Conformidade fiscal/bancária requer escopo jurídico e especialista.
