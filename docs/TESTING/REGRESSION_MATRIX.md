# Regression matrix — suites obrigatórias

| ID | Prioridade | Fluxo | Tipo de prova | Onde rodar |
|---|---|---|---|---|
| REG-001 | P0 | Usuário de Tenant A não lê/escreve Tenant B por API | integration + adversarial + property | PR + nightly |
| REG-002 | P0 | Troca de papel/permissão é refletida imediatamente nos atos críticos | integration + E2E | PR + nightly |
| REG-003 | P0 | Módulo desativado bloqueia escrita sem destruir histórico | contract + integration + E2E | PR + nightly |
| REG-004 | P0 | Matrícula transacional não duplica após retry ou double click | unit + integration + E2E | PR + nightly |
| REG-005 | P0 | Reprocessar cobrança/evento não duplica saldo/lançamento | property + integration + replay | PR + nightly |
| REG-006 | P0 | Cancelamento/reversão mantém auditoria e reconciliação | unit + integration + E2E | PR + nightly |
| REG-007 | P0 | Entrada não autorizada em função financeira | E2E + security | PR + nightly |
| REG-008 | P0 | Contrato OpenAPI permanece compatível com cliente gerado | schema diff + generated diff | PR |
| REG-009 | P0 | Restore de backup de tenant de teste recupera íntegros dados permitidos | restore drill | antes do piloto e periodicamente |
| REG-010 | P0 | Logs não vazam PII ou tokens em caminhos de erro | integration + security | PR + nightly |
| REG-011 | P1 | Formulário de matrícula acessível por teclado/leitor de tela | Storybook + Playwright + auditoria manual | PR + release |
| REG-012 | P1 | Temas claro/escuro, zoom e traduções não quebram UI | visual + a11y | PR + nightly |
| REG-013 | P1 | Workflow de matrícula suspenso e retomado sem duplicar evento | integration + E2E | nightly |
| REG-014 | P1 | Upgrade/downgrade de plano preserva dados e permissões | integration + E2E | nightly |
| REG-015 | P1 | Queda do serviço externo aciona retry/backoff e dead-letter | fault injection | nightly |

**Estado:** estes são cenários *propostos*, ainda não implementados ou executados. Cada cenário só passa a ativo após spec/contract aprovados e CI configurada. Lista P0 deve ser revisada em toda feature nova; 100% de execução de P0 significa zero cenário crítico conhecido sem teste.
