# Coverage QG-100 — definição técnica sem atalhos

**Alvo:** arquivos críticos de código de negócio cobertos individualmente em statements, branches, functions, lines = **100/100/100/100**.

Aplicação inicial: `packages/domain/src/{identity,tenancy,authorization,finance,enrollment,entitlements}/**/*.{ts,tsx}` após estruturação. Config de referência em `templates/vitest.config.example.ts`, a adaptar ao layout e versão verificados.

Diferenciar *não instrumentado* de *100%*: o conjunto de arquivos deve aparecer no relatório mesmo se não importado pelos testes. Falha de instrumentação deve ser tratada como FAIL.

### Anti-gaming

- Não desabilitar `branch` nem reduzir threshold da pasta de domínio.
- Não excluir handlers críticos, invariantes ou testes de errors.
- Excluir somente arquivos gerados, interfaces/`.d.ts`, bootstrap não executável, mocks e fixtures, com whitelist documentada.
- Não confiar apenas em snapshots e testes sem asserts comportamentais.
- Mesmo que 100%, revisar testes de mutations, invariantes de domínio e autorização real com infraestrutura.

Para UI e glue code, métricas de cobertura complementares devem ser definidas por risco, sem fingir que 100% de cobertura global de navegador implica qualidade. Os quatro 100% são compromisso firme para os módulos críticos selecionados, enquanto qualidade do sistema inteiro depende dos outros gates.
