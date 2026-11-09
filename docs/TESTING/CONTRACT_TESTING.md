# API-first + contract testing

1. Spec de negócio APPROVED inclui modelo de recurso, autenticação, autorização, estados, erros e idempotência.
2. OpenAPI versionado representa o contrato publicado (exemplo ilustrativo em `specs/contracts/openapi.yaml`).
3. Diferença de contrato OpenAPI em CI: endpoints/fields removidos ou restrições que quebram consumidores bloqueiam PR.
4. Orval gera hooks TanStack Query e tipos, podendo gerar mocks MSW; `orval --check`/`git diff --exit-code` conforme versão instalada (validar comando).
5. Teste de integração garante que o provedor realmente devolve o schema.
6. Erros estáveis têm códigos internos e HTTP apropriados; *mensagens* não servem como contrato.
7. Webhooks/eventos assíncronos têm schemas versionados, retries, idempotência e compatibilidade de consumidores.
8. E2E usa API real no stack de teste para cenários P0; mocks só em testes isolados.
