# RELEASE G3 — Consolidado

Branch feat/edu-domain (local) · 2026-11-08

## Entregas
- packages/education: EnrollmentService (state machine 7 estados, idempotência por key, refs verificáveis cross-tenant) + Ledger (Money centavos inteiros, append-only, idempotência escopada por tenant, reversão vinculada não-cadeável, property de conservação LCG).
- 54 testes · coverage 100/100/100/100 perFile · mutation 95,21% ≥ 95 · 12 ataques adversariais bloqueados (3 viraram fix de produção).

## Commits
16092c9 feat(education) · 532af0b fix(education) QA findings · <this> docs(review+release)

## Gates
B1..B6 PASS (ver REVIEW-G3.md). CI/push NOT RUN (versionamento local — repo oficial pendente Ezequias).

## Próxima onda (G4)
Postgres real de teste (docker), migrations idempotentes expand→migrate→contract, concorrência transacional, contracts OpenAPI — cards criados quando humano aprovar sequência ou no próximo ciclo do gauntlet.
