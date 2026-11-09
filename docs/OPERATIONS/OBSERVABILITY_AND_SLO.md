# Observabilidade e SLI/SLO

## SLIs candidatos

Disponibilidade real em jornadas críticas (matrícula, autenticação, emissão de título), latência por endpoint e papel, sucesso de fila/outbox, drift de reconciliação, erro de autorização/cross-tenant, tempo de recuperação de backup e erro de formulários.

## Telemetria

Logs estruturados com correlationId/tenant pseudonimizado, tracing distribuído quando houver vários serviços, métricas RED/USE conforme necessidade, alertas por sintomas. Nunca logar CPF, número de cartão, tokens ou prontuários escolares.

## Objetivos

Definir SLO por severidade com orçamento de erro em ADR específica. **Não inventar 99.99% como compromisso sem infraestrutura e demonstração.**

## Operação de incidentes

Runbook on-call, classificação P0-P3, comunicação, contenção, rollback e postmortem sem culpabilização. Eventos de segurança e dados seguem fluxo especializado.
