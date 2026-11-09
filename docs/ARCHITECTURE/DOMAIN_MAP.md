# Bounded contexts e vocabulário ubíquo

| Contexto | Entidades iniciais | Invariantes fundamentais |
|---|---|---|
| Organizations | Tenant, Unit, Membership | usuário só opera escopo autorizado |
| People | Person, Student, Guardian, Contact | duplicidade e PII tratadas explicitamente |
| Enrollment | Application, Enrollment, ClassSeat, Contract | estado transicional e capacidade consistente |
| Sales | Lead, Opportunity, FunnelStage, Proposal | origem e tratamento de dados justificados |
| Academic | Course, Offering, Class, Session, Attendance | turma/horário e acesso docente válidos |
| Finance | Invoice, Receivable, Payment, Adjustment, LedgerEntry | imutabilidade lógica, reconciliação e idempotência |
| Communications | Template, Notification, Consent, Delivery | opt-outs e canal auditados |
| Workflow | Recipe, Version, Run, StepExecution | versões fixas por execução, guards e compensações |
| Subscriptions | Plan, Entitlement, Subscription | feature licenciada avaliada no servidor |
| Audit | AuditRecord, CorrelationID | integridade, retenção e minimização |

Nomes são candidatos, não esquema final. Definir contratos, estados e eventos antes do schema físico.
