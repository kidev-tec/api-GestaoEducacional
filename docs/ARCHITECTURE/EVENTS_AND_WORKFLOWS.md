# Eventos e receitas

Eventos de domínio devem carregar `event_id`, `event_type`, `event_version`, `occurred_at`, `tenant_id`, `aggregate_id`, `correlation_id`, `payload` mínimo; nunca dados sensíveis desnecessários.

Exemplos candidatos: `EnrollmentConfirmed`, `ReceivableIssued`, `PaymentConfirmed`, `AttendanceRecorded`, `RecipeRunStarted`, `RecipeStepBlocked`. Nomes/contratos só após aprovação do contexto.

Consumidores devem tolerar duplicidade, reordenação quando aplicável e falha transitória. Outbox/inbox e dead-letter strategy sujeitos a ADR. Em finanças, não compensar uma confirmação externa com exclusão local; usar ajuste/estorno auditado.

Uma receita é uma máquina de estados versionada, com permissões e rollback lógico. Nenhum usuário configura scripts arbitrários capazes de acessar segredos ou API irrestrita.
