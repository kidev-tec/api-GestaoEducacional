# Orval — integração de contratos com front-end

## Quando vale a pena

Sim: React + TypeScript, APIs REST OpenAPI, múltiplos módulos e necessidade de contratos consistentes. Orval gera clientes e tipos, hooks React Query e mocks para MSW. **Não** substitui validação do backend, authz ou testes de integração.

## Fluxo recomendado

`specs/canonical/…` → `packages/api-contract/openapi.yaml` → validador OpenAPI → API implementa contrato → Orval gera em `apps/web/src/api/generated/` → component+MSW → integração+E2E real → PR gate de diff.

## Segurança

Configurar mutator HTTP para anexar auth/correlation context da sessão, tratar erros e desabilitar retries inseguros em mutações financeiras. Nunca colocar tokens no código gerado nem aceitar tenantId fornecido pelo browser como fonte de autoridade.

## Exemplo de configuração

`templates/orval.config.example.ts`: apenas molde para copiar e adaptar após criação da aplicação. O input `packages/api-contract/openapi.yaml` deve existir e passar nos testes de contrato.

## CI

Rodar validação de schema, geração, `git diff --exit-code` no diretório gerado, typecheck e testes de contrato. Atualização do contrato sem cliente regenerado = fail.
