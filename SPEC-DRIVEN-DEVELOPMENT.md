# SPEC-DRIVEN DEVELOPMENT (SDD) + TEST-DRIVEN DEVELOPMENT (TDD)

## O contrato

`Observação autorizada → Problema de negócio → Spec verificável → Revisão → Testes RED → Implementação GREEN → Refactor → Integração/E2E → Gate → PR → Aprovação`.

**ARCHITECTURE.md orienta as fronteiras e DESIGN.md orienta UX/UI; ambos estão DRAFT até revisão. Spec APPROVED é fonte normativa do comportamento a implementar**; card representa trabalho, ADR registra decisão, contrato OpenAPI representa interface, testes verificam comportamento, relatórios comprovam execução.

## Estrutura e estados

- `specs/cards/<CARD_ID>.md`: escopo de cada um dos 123 cards, inicialmente `DRAFT`.
- `specs/canonical/<SPEC_ID>.md`: requisitos completos de comportamento de alto risco.
- `specs/contracts/openapi.yaml`: contrato base ilustrativo; só se torna fonte de verdade depois de aprovado.
- `specs/traceability.json`: índice para localizar especificações pelos cards.
- `docs/ARCHITECTURE/`: boundaries, extensões, contratos e ADRs.

Estados: `DRAFT` → `IN_REVIEW` → `APPROVED` → `IMPLEMENTING` → `VERIFYING` → `ACCEPTED` → `SUPERSEDED`. Um agente não pode se autoaprovar como `APPROVED` ou `ACCEPTED`.

## Desenho de solução por card

Quando o card tiver impacto estrutural, integração, persistência ou risco elevado, usar `templates/FEATURE_DESIGN_TEMPLATE.md` para criar `specs/design/<CARD_ID>-design.md` (local alvo quando código e features existirem). `DESIGN.md` na raiz governa UX/UI transversal; o desenho técnico por card detalha a implementação autorizada. Nenhum deles substitui ADR aprovada ou spec de comportamento.

## Checklist de uma spec APPROVED

1. Identidade: versão, dono, card, objetivo, atores e boundary.
2. Premissas/limites expressos; dependências; definição de termos.
3. Fluxo principal e alternativos; regras de invariantes; eventos e erros.
4. Matriz de autorização (`actor × action × resource × tenant`).
5. Dados e privacidade, PII, retenção, idempotência e concorrência quando aplicável.
6. Contratos OpenAPI/JSON Schema/Event Schema (compatibilidade).
7. Cenários Gherkin positivos, negativos, cross-tenant, retry e falha parcial.
8. NFRs mensuráveis e a forma de medição (dispositivo, carga, ambiente).
9. Plano de testes (unit, property, integration, contract, E2E, security, a11y).
10. Critérios de aceite e evidências verificáveis; **risco de regressão**; rollback.
11. Referências autorais próprias — nada de exportação de código/assets proprietários.
12. Aprovação humana quando altera finanças, dados sensíveis, authz, billing ou produção.

## Ciclo TDD operacional para agentes

- **RED:** criar teste que falha pelo motivo certo e registrar comando/resultado; evitar teste que falha por configuração ausente.
- **GREEN:** implementar a menor mudança necessária; jamais desabilitar teste ou enfraquecer assert.
- **REFACTOR:** melhorar desenho sem mudar comportamento, rodar suíte associada e regressão.
- **PROVE:** rodar coverage e gates 100/100/100/100 onde aplicável, property/mutation e integration/E2E conforme classificação.
- **SHIP:** PR com evidências, revisão independente, decisão humana para riscos altos.

## Change control

Uma mudança de requisito passa por `RFC` + nova versão da spec e atualização de testes. Mudanças de contrato incompatíveis exigem versionamento/deprecation e plano de clientes. Impossível testar? A lacuna vira bloqueio documentado, não `PASS` fictício.

## Critério de bloqueio

Card sem spec → apenas pesquisa, teste de hipótese, spike autorizado ou documentação. Nenhum agente decide sozinho flexibilizar o padrão 100/100/100/100 em domínio crítico. Exceção exige RFC técnica, tratamento compensatório, owner humano e prazo.
