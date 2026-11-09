# Workflow operacional por card

## 0. Preparação

Ler backlog, prioridades, dependências, decisões aprovadas e estado atual. Validar que apenas um agente detém o lock lógico do card e das pastas críticas.

## 1. Reconhecimento

Identificar escopo, arquitetura afetada, contratos e testes existentes. Para E01, usar REA somente após autorização. Distinguir evidência de opinião.

## 2. Planejamento

Gerar plano com arquivos a alterar, novos contratos, cenários positivos/negativos, rollback, dados sintéticos, riscos e necessidade de aprovação. Revisar se envolver finanças, dados pessoais ou migrations.

## 3. Implementação

Preferir testes que expressem regras de negócio; implementar menor mudança possível; não criar módulos opcionais sem aceite; seguir design tokens e arquitetura de domínios.

## 4. Validação

Executar lint/typecheck/testes reais e cenários E2E quando disponíveis. Registrar `NOT RUN` explicitamente. Para cards de pesquisa, validar revisão de evidências e fonte.

## 5. Revisão e entrega

Executar checklist `QUALITY_GATES.md`; revisão independente; PR; approval humano quando nível A3/A4. Atualizar memória operacional e métricas do card.

## Estados oficiais

`BACKLOG` → `READY` → `IN_PROGRESS` → `IN_REVIEW` → `VERIFIED` → `DONE`.
Estados excepcionais: `BLOCKED`, `NEEDS_DECISION`, `REWORK`.

`DONE` exige aceite do responsável (humano ou política formal de aceite para trabalhos locais não sensíveis). Uma proposta de agente nunca é aceite implícito.
