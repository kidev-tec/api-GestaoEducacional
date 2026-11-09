# G6a — E2E de tela contra API real (aceite da SPEC v1.1.0)

Data: 2026-11-09 · Executor: orquestrador (takeover) · Local only

## Ambiente
- Postgres dev efêmero: container `erp-dev-pg` (postgres:16-alpine, porta 55432), migration `001_init.sql` aplicada, tenants A/B.
- API: Fastify em http://localhost:3000 (DATABASE_URL local, CORS `@fastify/cors` para origem 5173).
- Web: Vite dev server http://localhost:5173, tokens via package `@erp/tokens` (exports ./tokens.css).
- Browser: Chrome via DevTools MCP (usuário sintético, sem mocks).

## Correções saídas do E2E (bugs reais encontrados)
1. **CORS ausente** — preflight 5173→3000 bloqueado. Fix: `@fastify/cors` em `apps/api/src/app.ts` (origins configuráveis em `BuildOptions.corsOrigins`). API: 16/16 E2E re-executados, tsc clean.
2. **Tokens não carregados** — `<link>` relativo fora do root do Vite não é bundled. Fix: `@erp/tokens` com `exports: { "./tokens.css": "./src/tokens.css" }`, consumo `import '@erp/tokens/tokens.css'` em main.tsx; dependência adicionada a apps/web. `.sr-only` adicionado aos tokens.
3. **Duplicação de import** em EnrollmentsView (client importado 2×) consolidada.

## Cenários executados (evidência: screenshots neste diretório)
| # | Cenário | Resultado |
|---|---------|-----------|
| 1 | Render com tokens (fundo page, botão teal AA, focus ring) | OK (e2e-tela pré-fix não guardado; pós-fix nos PNGs) |
| 2 | Criar matrícula tenant A (aluno-e2e-001 / oferta-tads-2026) | OK — `enr-f15f35ea-…` criada, feedback de sucesso, estado DRAFT |
| 3 | Transição DRAFT → PENDING_DOCUMENTS | OK — label humano "Pend. documentos", próximo botão correto |
| 4 | Lançamento Cobrança R$ 150,00 | OK — `led-58c4e6e0-…`, saldo R$ 0,00 → R$ 150,00 (centavos→pt-BR) |
| 5 | Auditoria tenant A | OK — 3 registros (matrícula, transição, lançamento) |
| 6 | Isolamento: trocar p/ tenant B | OK — saldo B = R$ 0,00 (não vaza A) |
| 7 | Persistência tenant no localStorage após reload | OK — B mantido |
| 8 | Voltar p/ tenant A | OK — saldo R$ 150,00 preservado |

## Gates G6a consolidados
- Unit/RTL: 29/29 · coverage 100/100/100/100 perFile (v8) · tsc clean (web + api)
- API E2E: 16/16 (pós-CORS)
- E2E tela→API real: cenários 1-8 acima, zero erro de console da aplicação

## Pendências (fora do escopo G6a)
- Transição inválida via UI (422 humano): coberto por unit + API E2E; fluxo de duplo-clique/idempotência coberto pela API.
- Build de produção (`vite build`) — executar na QA G6a.

## Build produção (2026-11-09)
`vite build`: 35 módulos, dist/index.html 0.40 kB, index-*.css 1.70 kB (tokens bundled), index-*.js 232.22 kB (gzip 72.81 kB) — EXIT 0.
