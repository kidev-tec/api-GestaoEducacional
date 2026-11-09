@P0 @education @idempotency
Feature: matrícula confiável
  Scenario: operador faz duplo clique na confirmação
    Given uma intenção de matrícula válida no tenant A
    When a mesma operação é enviada duas vezes com chave idempotente K
    Then exatamente uma matrícula é persistida
    And as respostas correspondem ao mesmo recurso
