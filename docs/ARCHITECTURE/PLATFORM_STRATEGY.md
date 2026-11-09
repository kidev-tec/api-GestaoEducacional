# Plataforma ERP multissetorial — core + verticals

## Princípio

**Primeiro cliente é uma escola; primeira arquitetura é uma plataforma.** Não escrever lógica educacional dentro do core transversal. Tampouco inventar generalização abstrata demais que atrase a entrega real da escola.

```
[Web Shell / Mobile futuro / APIs]
              |
[Core: tenancy, IAM, policies, audit, billing/entitlements,
       notification, workflow, contracts, outbox, observability]
              |
[Modules SDK + events/ports + ACL/RBAC policy contracts]
              |
[education: CRM → enrollment → academic → financial adapters]
              |
[future verticals: services, retail, healthcare*, etc.]
```
`*` setores regulados exigem escopo, especialistas e requisitos próprios. Nenhuma capacidade futura está implementada nem prometida.

## Caminho sugerido

Monólito modular TypeScript com bounded contexts e esquema de banco disciplinado, PostgreSQL, jobs assíncronos e outbox. APIs HTTP tipadas com OpenAPI como contrato público; RPC interna opcional com fronteiras claras. Não microserviços até que métricas operacionais demonstrem necessidade.

## Fronteiras

Core sabe `Party`, `Account`, `Tenant`, `User`, `Permission`, `Subscription`, `Feature`, `WorkflowInstance`, `AuditRecord`, `IntegrationConnection`. Educação sabe `Student`, `Guardian`, `Class`, `Enrollment`, `Lesson`, `Attendance`.

Os nomes genéricos não substituem modelagem: `Party` não equivale automaticamente a `Student`; extensões podem adicionar papéis sem colocar conceitos de escola no core. Faturamento educacional depende de matrícula, mas billing de módulos SaaS é transversal e **não** deve se misturar com contas a receber da escola.

## Regras

1. Dependência sempre módulo → core, nunca core → educação.
2. Um módulo expõe contratos e handlers estáveis, não tabelas diretamente a outros módulos.
3. Migrations versionadas com `expand → migrate → contract`, rollback planejado.
4. Tenant context derivado da sessão e checado em todo acesso; batch/jobs também.
5. Entitlements e feature flags avaliados no serviço e na API, nunca só na interface.
6. Eventos versionados e replay seguros; outbox transacional antes de integrar externos.
7. Sem marketplace de plugins externos no MVP; SDK interno com contrato e aprovação.
8. Para abrir segunda vertical, realizar prova de portabilidade baseada num módulo real, não apenas diagramas.

## Decisões antes de codificar

Criar ADR para banco e modelo de tenancy, mecanismos de autorização, catálogo de módulos, contrato OpenAPI, eventos, workflows, ID globais e histórico/auditoria. Referenciar `docs/ARCHITECTURE/DECISIONS_TO_MAKE.md`.
