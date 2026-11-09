# FEATURE DESIGN — <CARD_ID> — <nome da capacidade>

> Status: DRAFT · Owner: <responsável> · Spec: `specs/cards/<CARD_ID>.md` · ADRs: <links> · Versão: 0.1

Este documento descreve o **desenho técnico de uma funcionalidade**, distinto da arquitetura global (`ARCHITECTURE.md`) e do contrato transversal de UX/UI (`DESIGN.md`). **Não é aprovação de implementação**.

## 1. Problema, limite e sucesso
- Usuários, situação de negócio, resultados mensuráveis e não objetivos.
- Entradas, saídas, restrições e serviços/verticais afetados.

## 2. Alternativas e trade-offs
| Opção | Benefícios | Custos/risco | Decisão e evidência |
|---|---|---|---|
| A | | | |
| B | | | |

## 3. Desenho de solução
- Diagrama de sequência ou componentes (Mermaid).
- Fluxo principal e alternativos; regras, invariantes e validação.
- Contratos OpenAPI/eventos e versionamento; compatibilidade.
- Modelo de dados, ownership, transações, isolamento de tenant, índices e migrations.
- Autorização server-side, permissões, entitlements, LGPD e threat model.
- Idempotência, deduplicação, concorrência, retries e falhas parciais.
- Estados de UI, acessibilidade, responsividade e tokens (quando houver interface).
- Telemetria, SLI e estratégia de rollback.

## 4. Plano Red → Green → Refactor
| Cenário verificável | Nível (unit/integration/contract/E2E) | Teste RED | Evidência GREEN |
|---|---|---|---|
| Happy path | | | |
| Unauthorized e cross-tenant | | | |
| Invalid input, retry e conflito | | | |
| Falha parcial/reversão | | | |

## 5. Impacto e dependências
- Módulos, consumidores, outros cards, riscos de migração e plano de rollout.
- Analisar mudança de API/evento e necessidade de novo ADR.

## 6. Critérios de revisão
- [ ] Spec `APPROVED` por responsável, decisões aprovadas quando obrigatórias.
- [ ] Sem acoplamento proibido, imports ilegais ou consulta a tabelas de outro módulo.
- [ ] Riscos financeiros, cross-tenant e de privacidade modelados.
- [ ] Tests definidos antes da implementação; gates exigidos e evidências verificáveis.
- [ ] Revisão de UX, segurança e arquitetura apropriadas ao risco.

## 7. Aprovações
- Revisão técnica: <identidade, data, referência>
- Aprovação de risco humano (quando exigida): <referência>
- Estado real dos testes: NOT RUN até execução comprovada.
