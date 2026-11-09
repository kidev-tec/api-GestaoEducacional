# Arquitetura alvo — proposta sujeita a ADR

## Princípios

- **Monólito modular** inicialmente, com fronteiras explícitas de domínio, contratos e eventos internos; microserviços só com evidência de necessidade de escala ou isolamento.
- SaaS multi-tenant com `tenant_id` e `unit_id` quando pertinentes; identidade, permissões e checagens server-side em qualquer acesso.
- Priorizar contratos de dados, consistência, auditoria, isolamento, experiência e extensibilidade em vez de copiar complexidade de SAP/Oracle.
- Receitas de processos versionadas, seguras e auditáveis; módulos vendidos via entitlements e nunca por checagem só na UI.

## Stack candidata (não decidido)

Frontend React + TypeScript; API Node.js + TypeScript (Fastify ou NestJS a decidir); PostgreSQL; schema validation; query layer/ORM a decidir; monorepo opcional (pnpm/Turborepo); Redis/queue apenas se necessário; storage compatível S3; OpenTelemetry; Vitest/Playwright.

Cada escolha precisa de ADR com custo, equipe, operação, suporte, licença e reversibilidade. **Não implementar scaffolding arbitrário antes de E03-01/E03-02.**

## Contextos de domínio

Identity & Access, Organizations, People, Enrollment, Academic, Sales CRM, Contracts, Finance, Communications, Workflow Recipes, Integrations, Reporting, Subscription & Entitlements, Audit.

## Comunicação entre contextos

Use application services e contratos de eventos com outbox quando necessário. Evitar ler e alterar tabelas privadas de outros módulos. Publicações de evento não substituem transações locais. Contabilização/financeiro exige consistência e reconciliação.

## Dados e segurança

Modelos por tenant; estratégias de banco e RLS só após ADR; criptografia em trânsito/repouso, gestão de segredos, backup e restauração testada. Nunca confiar em tenant id vindo exclusivamente do cliente.

## Operação

CI, migrations versionadas, telemetria, SLI/SLO definidos por jornadas, rollback/feature flags aprovadas, proteção de branches, runbooks e disaster recovery ensaiado.
