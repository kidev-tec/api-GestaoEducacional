# ADR-0001 — Plataforma ERP core + vertical Educação

- Status: **PROPOSED** (não aprovado)
- Contexto: a escola é cliente inicial, mas outros setores podem ser atendidos depois.

## Opções

A. ERP apenas escolar e refatorar no futuro (rápido, risco de lock-in educacional).
B. Núcleo genérico com dezenas de serviços plugáveis desde o início (alto custo/complexidade).
C. **Monólito modular com core estreito e educação como vertical** (proposta recomendada).

## Proposta

Adotar C se validação confirmar: modules via manifest interno, boundaries `core/education`, APIs versionadas e testes contract-first. Nunca criar abstração universal sem caso real. Promover módulos para core após segunda implementação independente ou necessidade inequívoca.

## Trade-offs

Exige disciplina de boundaries e testes arquiteturais; menor custo operacional que microservices. Precisa de revisão sobre tenancy, data privacy e licensing.

## Aprovação

PENDENTE. Não construir código de produção em cima deste documento sem validação de arquitetura e responsáveis.
