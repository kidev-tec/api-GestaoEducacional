@P0 @security @isolation
Feature: isolamento de organizações
  Scenario: operador tenta acessar recurso de outro tenant
    Given um operador autenticado no tenant A
    And um recurso privado do tenant B
    When ele requisita o recurso com um identificador válido de B
    Then nenhuma informação de B é retornada
    And nenhuma alteração em B é persistida
