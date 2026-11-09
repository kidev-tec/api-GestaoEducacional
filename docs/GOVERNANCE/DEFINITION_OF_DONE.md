# Definition of Done

Um card está concluído quando: objetivo e critérios de aceite conferidos; dependências atendidas; mudança restrita ao escopo; documentação de domínio/ADR atualizada; testes positivos e negativos executados quando aplicáveis; segurança e multi-tenant verificados; UX e acessibilidade verificadas em UI; logs/traces sem PII; evidências e PR anexados; revisão independente concluída; rollback documentado para mudanças operacionais; estado e handoff atualizados.

### Casos especiais

- **Pesquisa:** protocolo, evidências autorizadas, classificação observado/inferido/não verificado, lacunas e decisões propostas.
- **Design:** protótipo, tokens, estados, critérios de acessibilidade e validação por papel.
- **Finanças:** idempotência, imutabilidade/ajustes auditáveis, conciliação, falha externa e autorização explícita de ação real.
- **Dados/migração:** dry-run e reconcile, PII protegida, rollback e trilha de origem.
- **Documentação:** links válidos, exemplos testados, responsável, versão e não contradição com ADRs.

O agente NÃO marca DONE se não puder executar verificação crítica; registra BLOCKED ou IN_REVIEW.
