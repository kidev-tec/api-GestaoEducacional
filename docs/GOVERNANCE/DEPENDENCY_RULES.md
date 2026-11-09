# Dependências, execução paralela e controle de conflito

- `Dependências` do backlog devem ter status `VERIFIED` ou `DONE` antes do card dependente entrar em implementação; pesquisa pode antecipar sem alterar código.
- Cards no mesmo bounded context podem compartilhar contratos e, portanto, devem serializar alteração de schemas ou escrever RFC antes de trabalhar paralelo.
- Escritores em paralelo usam branches/worktrees isolados e ownership por conjunto de arquivos; não criar locks falsos sem integração ao orquestrador real.
- Artefatos de IA são rascunhos até revisão; não sobrescrever mudanças humanas silenciosamente.
- Mudanças amplas que envolvam >1 módulo ou dados precisam de avaliação de compatibilidade, rollout gradual e plano de migração.
