# Contrato de módulo — visão de produto, técnica e licenciamento

## Manifest declarativo (rascunho, sujeito a ADR)

```ts
export type ModuleManifest = {
  key: string;               // edu.enrollment, core.crm, etc.
  version: string;           // semver
  category: 'core' | 'vertical' | 'addon';
  dependsOn: string[];
  capabilities: string[];    // edu.enrollments.read / .write
  permissions: string[];
  uiRoutes?: string[];       // declarativo; UI não autoriza
  dataClassification: ('public'|'internal'|'personal'|'sensitive')[];
  migrationPlan: 'expand-contract';
}
```

## Ciclo de vida

`AVAILABLE → TRIAL → ACTIVE → GRACE → SUSPENDED → CANCELED` é um exemplo de estados a especificar. Suspender um módulo não pode corromper dados, quebrar vínculos de outros módulos nem excluir histórico financeiro. Assinatura do SaaS ≠ transações financeiras da instituição.

## Entitlements

- Tenant e opcionalmente unidade escolar, vigência, quotas e features, `deny-by-default`.
- Verificação no backend e registro de mudanças de licença no audit trail.
- Plano `FREE/TRIAL/PAID` é nomenclatura provisória; contrato comercial define.
- Workers e webhooks não podem chamar endpoints/handlers de módulos suspensos sem política explícita de graceful shutdown.
- Dados existentes podem exigir acesso somente leitura/exportação sob obrigações contratuais e LGPD.

## Conformidade do módulo

Todo módulo deve publicar spec, OpenAPI ou interface pública, testes unitários de regras, integração, autorização cross-tenant, contratuais, E2E do caminho crítico, docs de operação e acessibilidade da UI. Não gerar permissões dinâmicas que possam escalar privilégios.
