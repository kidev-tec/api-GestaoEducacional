# Padrões de interação — primeira versão

## Navegação por persona

- Secretaria: pessoas, matrículas, documentos, pendências.
- Comercial: leads, propostas, conversão, tarefas.
- Financeiro: títulos, recebimentos, conciliação, inadimplência.
- Docente: turmas, chamada, conteúdo, avaliações.
- Direção: indicadores explicáveis, exceções, auditoria e saúde operacional.

## Componentes obrigatórios

AppShell com navegação adaptável; Breadcrumbs; DataTable com filtro, paginação e exportação autorizada; FormWizard com autosave seguro; StateBadge com texto; AuditTimeline; EmptyState; BulkActionConfirm; PermissionGuard (apenas UX, backend independente); WorkflowStepper; InsightCard com fonte/data/explicação; NotificationCenter acessível.

## Matriz de estados

Todo componente de dados assíncronos: idle, loading, success, empty, permission-denied, validation-error, network-error, partial, stale. Estados de operação financeira e matrícula exigem IDs correlacionáveis, mas não expor identificadores internos indiscriminadamente.

## Formulários

Rótulos visíveis, máscara não substitui validação server-side, campos condicionais explicáveis, recuperação de rascunho, resumo de erros com foco, validação por campo e no submit. Não bloquear copy/paste de senhas.

## Operações destrutivas e sensíveis

Confirmação contextual com impacto e alvo; preferir reversão/estorno ao DELETE em finanças; revalidar permissão e trilha de auditoria. Não usar "tem certeza?" isolado.

## Fluxos Receita

Visualização de etapas, responsável, dependências, próxima ação, timeout e evento disparado. Opção de simular antes de publicar e histórico de versões.
