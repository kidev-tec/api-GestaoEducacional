@P0 @finance @replay
Feature: contabilização financeira segura
  Scenario: processamento duplicado de webhook
    Given um evento de pagamento sintético processado uma vez
    When o mesmo evento é entregue novamente
    Then não existe segundo lançamento no ledger
    And o total conciliado permanece constante
