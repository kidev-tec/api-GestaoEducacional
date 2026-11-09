# Receita para o sucesso: motor de processos

## Metáfora de produto (não gastronomia literal)

- **Ingredientes** = dados, pessoas, regras, permissões, condições de entrada.
- **Preparo** = etapas, responsáveis, aprovações, timers e automações.
- **Resultado** = saída verificada: matrícula concluída, cobrança conciliada ou aluno acompanhado.
- **Ajustes da receita** = templates por instituição e versão, sem alterar contratos de core.

## Receita exemplar: matrícula sem retrabalho

1. Lead qualificado e consentimento/origem documentados.
2. Proposta com curso, turma, política comercial e responsável.
3. Documentos requeridos validados (com política de minimização).
4. Contrato gerado a partir de template versionado e aprovado.
5. Matrícula confirmada de forma idempotente com registro de evento.
6. Plano de cobrança criado conforme acordo; não realizar transação externa sem autorização.
7. Alertas e tarefas de acompanhamento para secretaria/financeiro.
8. KPI: tempo até matrícula, itens bloqueados, abandono e retrabalho.

## Contrato mínimo de uma receita

`recipe_id`, `version`, `tenant_id`, `name`, `description`, `actors`, `preconditions`, `steps`, `guards`, `transitions`, `events`, `approvals`, `timeouts`, `compensation`, `metrics`, `audit_policy`.

**Guardrails:** sem execução arbitrária de código por usuário; sem executar receitas que elevem permissões; controle por versão e revisão; idempotência; isolamento multi-tenant; compensações explícitas; simulador/dry-run.

**MVP:** templates de workflow aprovados e regras limitadas. Editor visual complexo só após validação do uso.
