# REVIEW G6a — rodada 1 (independente, cx/gpt-5.6-terra via deleg_5303856f)

Veredito: **CHANGES** (2 findings)

## Findings
1. **HIGH** — LedgerView.tsx: `Number()`+`Math.round` arredondava centavos fracionários silenciosamente (0,001→0; 1,999→200). Viola RF-014.
2. **MEDIUM** — CORS sem teste automatizado allow/deny.

## Passes (7 verificações)
generated_client ✓ · css_bundling ✓ · a11y ✓ · secret_hygiene ✓ (npm audit prod: 0 vuln high) · tests ✓ · money centavos ✓ (exceto finding 1) · CORS default restrito ✓

# Rework (mesma branch)
1. HIGH → `parseReaisToCents()` estrito em domain.ts (regex `^\d{1,13}(,\d{1,2})?$`, recusa >2 casas, sinal, notação científica, zero; `Number.isSafeInteger`); LedgerView usa o parser; 14 asserts novos incluindo os 2 casos do review (0,001 e 1,999 → null).
2. MEDIUM → apps/api/test/cors.test.ts: 4 testes allow/deny (5173 permitido com eco, origem desconhecida sem allow-origin, 127.0.0.1 permitido, "null" não vira curinga) contra app real injetado + Testcontainers.

## Gates pós-rework
web 32/32 (100×4) · api 20/20 (16 e2e + 4 cors) · tsc clean web+api · vite build EXIT 0
