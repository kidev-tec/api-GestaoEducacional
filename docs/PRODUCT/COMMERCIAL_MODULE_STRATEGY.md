# Estratégia comercial modular

## Três eixos

1. **Plataforma Base:** tenant, unidade, colaboradores, IAM, auditoria, suporte e integrações nucleares.
2. **Capacidades transversais:** CRM, contratos, contas, estoques, processos, BI, automação, API premium (se fizer sentido).
3. **Verticais:** educação primeiro (admissões, turmas, frequência, avaliação etc.); outras só após validação.

Evitar fazer tudo como add-on cobrado: uma funcionalidade essencial à segurança, exportação LGPD ou acessibilidade não pode ser removida por falta de plano pago. Quotas por unidade e volume devem ser claras, previsíveis e auditáveis.

## Modelo técnico

Catálogo `module / plan / entitlement / limit / subscription`, histórico efetivo de alterações, cobrança idempotente, trial seguro, downgrade sem perda de dados, exportação estruturada, portabilidade e termos versionados. Cobrança recorrente de assinatura ERP é domínio separado do contas-a-receber educacional.

## Metas de negócio a validar

Tempo até o primeiro valor, adesão de módulo, taxa de conclusão de matrículas, tempo para relatórios, custo de suporte, retenção, churn, qualidade de dados e custo por tenant. Não apresentar números sem baseline do piloto.
