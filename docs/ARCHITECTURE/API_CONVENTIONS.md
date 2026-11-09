# Convenções de API — proposta

- OpenAPI versionada; usar HTTPS; `Authorization` com tokens sem guardar credenciais em logs.
- Contexto do ator, tenant e unidade derivado de autenticação/autorização, validado por policy.
- API com paginação estável, filtros documentados, ids opacos quando possível, timeouts e limites.
- Resposta de erro padronizada: `code`, `message`, `details` redigidos, `correlationId` e `retryable`.
- Escritas sensíveis com `Idempotency-Key` quando aplicável; não confundir retry com duplicação.
- Versionamento e depreciação explícitos; limites de leitura e exports para dados pessoais.
- Webhooks assinados, deduplicados e com retry/backoff controlado; sem confiar em origem só por IP.
- Log com trace_id e sem CPF, email, número de cartão, cookies ou dados de crianças.

Testes obrigatórios: tenant incorreto, papel sem autorização, sessão expirada, entrada inválida, replay/idempotência, condição de corrida e provedor indisponível.
