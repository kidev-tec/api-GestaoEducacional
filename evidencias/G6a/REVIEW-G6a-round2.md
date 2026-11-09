# REVIEW G6a — rodada 2 (independente, cx/gpt-5.6-terra via deleg_f307e1c9)

Veredito: **APPROVED** @ commit 071fa03, worktree limpo.

Evidências do reviewer:
- `parseReaisToCents` regex estrito; recusa 0,001, 1,999, sinais, notação científica, zero; apenas centavos inteiros positivos safe-integer.
- LedgerView usa o parser; nenhum `Math.round` em apps/web/src.
- Testes CORS cobrem localhost/127.0.0.1 permitidos e origem maliciosa/"null" negadas.
- Re-executado pelo reviewer: web vitest 32/32 (100×4), API vitest 20/20.
