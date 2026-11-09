# Property-based, mutation, concorrência e testes adversariais

- **fast-check:** gerar entidades, quantias em unidades inteiras, políticas de acesso e sequências de ações; invariantes devem valer independentemente da ordem possível.
- **Mutation:** usar ferramenta compatível com TypeScript (ex.: Stryker) e revisão manual de mutantes sobreviventes; meta de 95% nos módulos críticos após estabelecimento de baseline.
- **Concorrência:** executar duas tentativas simultâneas de matrícula, mudança de plano, assinatura de webhook, conciliação e cancelamento; observar serialização, unique constraints e locks transacionais.
- **Falhas parciais:** simular Postgres indisponível, fila atrasada, timeout HTTP, retry duplicado, crash antes/depois da outbox.
- **Segurança:** gerar combinações actor/tenant/resource/permission para achar IDOR e escalada de privilégio; não usar testes contra servidores sem autorização.
- **Critério:** teste de invariante primeiro; falha reproduzível e reduzida; correção com prova de regressão e evidência versionada.
