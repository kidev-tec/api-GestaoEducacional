# Specs — comportamento a aprovar antes do desenvolvimento

- `cards/`: 123 specs iniciais geradas automaticamente do backlog. **Status DRAFT, não aprovadas.**
- `canonical/`: exemplos trabalhados mais detalhados e *ainda sujeitos à aprovação*.
- `contracts/`: contrato OpenAPI ilustrativo. Não publica API real, nem descreve sistema em produção.
- `traceability.json`: mapeia IDs do backlog para docs e specs.

## Como aprovar

1. Selecionar card e verificar dependências.
2. Refinar objetivo, atores, regras, modelo de ameaça e dados com equipe da escola.
3. Se domínio crítico, revisar matriz negativa, concorrência e cross-tenant.
4. Revisar impacto entre módulos, OpenAPI e rollout.
5. Aplicar checklist do SDD, registrar o revisor humano e o commit/versão.
6. Só então promover a `APPROVED` e habilitar TDD RED.

Specs genéricas **não** substituem descoberta real nem decisões comerciais.
